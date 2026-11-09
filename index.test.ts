/**
 * Integration tests for the permission-modes extension.
 *
 * Strategy: import the extension factory with a fake `ExtensionAPI` stub.
 * The stub captures all `pi.on(event, handler)` subscriptions; we then invoke
 * the captured `tool_call` handler directly with crafted events and contexts.
 *
 * This lets us assert the gate decision tree without booting real pi.
 */

import { describe, expect, it, beforeEach, afterEach, vi } from "vitest"
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import permissionModesExtension from "./index.ts"
import { setConfigPath } from "./config.ts"
import { writeProjectPermissionsFile } from "./permissions-loader.ts"
import {
	listTrackedOutsideWrites,
	type OutsideWriteSnapshot,
} from "./utils.ts"
import { writePlanFile } from "./utils.ts"
import { getPlanFilePath } from "./utils.ts"
import {
	listPendingRequests,
	readForwardedResponse,
	setAgentDirForTests,
	writeForwardedRequest,
	writeForwardedResponse,
} from "./permission-forwarding.ts"
import type { Theme } from "@earendil-works/pi-coding-agent"
import type { TUI } from "@earendil-works/pi-tui"

// ---- minimal fake pi API ------------------------------------------------

type Handler = (event: unknown, ctx: unknown) => unknown | Promise<unknown>

type CommandHandler = (
	args: string,
	ctx: unknown,
) => unknown | Promise<unknown>

interface FakePi {
	handlers: Map<string, Handler[]>
	commands: Map<string, CommandHandler>
	commandDescriptions: Map<string, string>
	shortcuts: Map<string, Handler>
	tools: Map<string, { name: string; execute: (...args: unknown[]) => Promise<unknown> }>
	userMessages: Array<{ text: string; opts?: unknown }>
	sentMessages: Array<{
		message: { customType?: string; content?: unknown; display?: boolean }
		opts?: unknown
	}>
	appendEntries: Array<{ type: string; data: unknown }>
	activeTools: string[]
	allTools: Array<{
		name: string
		sourceInfo: { path: string; source: string; scope: string; origin: string }
	}>
	addTool: (name: string, source: string) => void
	flags: Record<string, unknown>
	setModelCalls: Array<{ model: unknown }>
	thinkingLevel: string
	modelRegistry: Map<string, Map<string, unknown>>
	getToolCallHandler: (mode?: string) => Handler | undefined
	simulateSessionStart: (
		cwd: string,
		ui?: unknown,
		registry?: { find: (provider: string, model: string) => unknown },
		sessionId?: string,
	) => Promise<void>
	simulateToolCall: (
		toolName: string,
		input: Record<string, unknown>,
		ctx: object,
	) => Promise<unknown>
	simulateRegisteredTool: (
		toolName: string,
		params: Record<string, unknown>,
		ctx: object,
	) => Promise<unknown>
	simulateCommand: (name: string, args: string, ctx: object) => Promise<unknown>
	simulateShortcut: (
		key: string,
		ctx: object,
	) => Promise<unknown>
}

interface FakeCtxOptions {
	mode?: "tui" | "rpc" | "print" | "json"
	cwd: string
	projectRoot?: string | null
	sessionId?: string
	sessionName?: string
	ui?: {
		select?: (label: string, options: string[]) => Promise<string>
		custom?: (factory: unknown, options?: unknown) => Promise<unknown>
		notify?: (msg: string) => void
		editor?: (label: string, val: string) => Promise<string | undefined>
	}
}

function createFakePi(): FakePi {
	const handlers = new Map<string, Handler[]>()
	const commands = new Map<string, CommandHandler>()
	const commandDescriptions = new Map<string, string>()
	const shortcuts = new Map<string, Handler>()
	const tools = new Map<string, { name: string; execute: (...args: unknown[]) => Promise<unknown> }>()
	const userMessages: Array<{ text: string; opts?: unknown }> = []
	const sentMessages: Array<{
		message: { customType?: string; content?: unknown; display?: boolean }
		opts?: unknown
	}> = []
	const appendEntries: Array<{ type: string; data: unknown }> = []
	const activeTools = ["read", "edit", "write", "bash", "grep", "find"]
	// Mirrors pi's getAllTools(): every registered tool plus its load-time
	// sourceInfo, which Read Only mode uses for plugin allowlisting.
	const allTools = [
		"read",
		"edit",
		"write",
		"bash",
		"grep",
		"find",
		"ls",
		"powershell",
	].map((name) => ({
		name,
		sourceInfo: {
			path: `<builtin:${name}>`,
			source: "builtin",
			scope: "temporary",
			origin: "top-level",
		},
	}))
	const flags: Record<string, unknown> = { "permission-mode": "ask" }
	const setModelCalls: Array<{ model: unknown }> = []
	let thinkingLevel = "off"
	const modelRegistry = new Map<string, Map<string, unknown>>()

	const pi = {
		handlers,
		commands,
		commandDescriptions,
		shortcuts,
		tools,
		userMessages,
		sentMessages,
		appendEntries,
		activeTools,
		allTools,
		addTool(name: string, source: string) {
			allTools.push({
				name,
				sourceInfo: {
					path: `/tmp/${name}.js`,
					source,
					scope: "user",
					origin: "package",
				},
			})
		},
		getAllTools() {
			return [...allTools]
		},
		flags,
		setModelCalls,
		getThinkingLevel: () => thinkingLevel,
		setThinkingLevel: (l: string) => {
			thinkingLevel = l
		},
		modelRegistry: {
			find: (provider: string, model: string) => {
				const providerMap = modelRegistry.get(provider)
				if (!providerMap) return undefined
				return providerMap.get(model)
			},
		},

		on(event: string, handler: Handler) {
			const list = handlers.get(event) ?? []
			list.push(handler)
			handlers.set(event, list)
		},
		registerCommand(name: string, def: { handler: CommandHandler; description?: string }) {
			commands.set(name, def.handler)
			commandDescriptions.set(name, def.description ?? "")
		},
		registerShortcut(key: string, def: { handler: Handler }) {
			shortcuts.set(key, def.handler)
		},
		registerTool(def: { name: string; execute: (...args: unknown[]) => Promise<unknown> }) {
			tools.set(def.name, def)
		},
		registerFlag(name: string, def: { default?: unknown }) {
			// Always record the flag so the extension can read it via getFlag.
			// Default is honored when provided.
			if (def?.default !== undefined) flags[name] = def.default
			else if (!(name in flags)) flags[name] = undefined
		},
		getFlag(name: string) {
			return flags[name]
		},
		appendEntry(type: string, data: unknown) {
			appendEntries.push({ type, data })
		},
		getActiveTools() {
			return [...activeTools]
		},
		setActiveTools(tools: string[]) {
			activeTools.length = 0
			activeTools.push(...tools)
		},
		sendUserMessage(text: string, opts?: unknown) {
			userMessages.push({ text, opts })
		},
		sendMessage(message: unknown, opts?: unknown) {
			sentMessages.push({ message: message as never, opts })
		},
		async setModel(model: unknown) {
			setModelCalls.push({ model })
			return true
		},

		// Test helpers
		getToolCallHandler() {
			const list = handlers.get("tool_call") ?? []
			return list[0]
		},
		async simulateSessionStart(
			cwd: string,
			ui?: unknown,
			registry?: { find: (provider: string, model: string) => unknown },
			sessionId?: string,
		) {
			const list = handlers.get("session_start") ?? []
			const fullCtx = makeCtx(pi, {
				cwd,
				ui: (ui ?? {}) as FakeCtxOptions["ui"],
				modelRegistry: registry ?? pi.modelRegistry,
				...(sessionId ? { sessionId } : {}),
			})
			for (const h of list) await h({}, fullCtx)
		},
		async simulateToolCall(
			toolName: string,
			input: Record<string, unknown>,
			ctx: object,
		) {
			const list = handlers.get("tool_call") ?? []
			for (const h of list) {
				const result = await h({ toolName, input }, ctx)
				if (result !== undefined) return result
			}
			return undefined
		},
		async simulateCommand(name: string, args: string, ctx: object) {
			const handler = commands.get(name)
			if (!handler) throw new Error(`No command registered: ${name}`)
			return handler(args, ctx)
		},
		async simulateRegisteredTool(
			toolName: string,
			params: Record<string, unknown>,
			ctx: object,
		) {
			const tool = tools.get(toolName)
			if (!tool) throw new Error(`No tool registered: ${toolName}`)
			return tool.execute("test-call", params, undefined, undefined, ctx)
		},
		async simulateShortcut(key: string, ctx: object) {
			const handler = shortcuts.get(key)
			if (!handler) throw new Error(`No shortcut registered: ${key}`)
			return handler(ctx)
		},
	}
	return pi
}

// Cast: we hand the fake pi to the extension factory which expects ExtensionAPI.
// The shape matches the subset of methods the extension actually calls.
function makeFakePiForExtension(p: FakePi) {
	return p as unknown as Parameters<typeof permissionModesExtension>[0]
}

function makeCtx(
	p: FakePi,
	opts: FakeCtxOptions & {
		modelRegistry?: { find: (provider: string, model: string) => unknown }
	},
) {
	const ui = opts.ui ?? {}
	return {
		cwd: opts.cwd,
		hasUI: !!opts.ui,
		mode: opts.mode ?? (opts.ui ? "tui" : "print"),
		modelRegistry: opts.modelRegistry ?? p.modelRegistry,
		ui: {
			select: ui.select ?? (async () => "Block"),
			custom: ui.custom ?? (async () => "stay"),
			notify: ui.notify ?? (() => {}),
			editor: ui.editor ?? (async () => undefined),
			setStatus: () => {},
			setWidget: () => {},
			setFooter: () => {},
			setWorkingIndicator: () => {},
			setWorkingMessage: () => {},
			theme: {
				fg: (_role: string, text: string) => text,
				strikethrough: (t: string) => t,
			},
		},
		sessionManager: {
			getBranch: () => [],
			getGitBranch: () => "",
			getEntries: () => [],
			...(opts.sessionId ? { getSessionId: () => opts.sessionId } : {}),
			...(opts.sessionName ? { getSessionName: () => opts.sessionName } : {}),
		},
		model: undefined,
	}
}

// ---- selector helpers ---------------------------------------------------

function selectorTui(rows = 40, columns = 120): TUI {
	return {
		terminal: { rows, columns, write: () => {} },
		requestRender: () => {},
	} as unknown as TUI
}

function selectorTheme(): Theme {
	return {
		fg: (_role: string, text: string) => text,
		bold: (text: string) => text,
		italic: (text: string) => text,
		strikethrough: (text: string) => text,
		underline: (text: string) => text,
	} as Theme
}

/**
 * Drive a permission gate through the custom (wrap-around) selector and pick
 * an option by label. `choose` receives the selector's option list, so tests
 * can assert order/content before returning a choice.
 */
function selectorCustom(
	choose: (options: readonly string[]) => string | undefined,
): (factory: unknown) => Promise<string | undefined> {
	return async (factory) => {
		const component = await (factory as Function)(
			selectorTui(),
			selectorTheme(),
			undefined,
			() => {},
		)
		return choose(component.options as readonly string[])
	}
}

// ---- tests --------------------------------------------------------------

describe("permission-modes extension: tool_call gate", () => {
	let pi: FakePi
	let realProjectRoot: string
	let configTmp: string

	beforeEach(async () => {
		pi = createFakePi()
		configTmp = mkdtempSync(join(tmpdir(), "pm-idx-cfg-"))
		setConfigPath(join(configTmp, "permission-modes.json"))
		writeFileSync(
			join(configTmp, "permission-modes.json"),
			JSON.stringify({ classifier: { enabled: false } }),
		)
		// Use real fs: the current repo IS a project (has package.json).
		realProjectRoot = process.cwd()
		permissionModesExtension(makeFakePiForExtension(pi))
		await pi.simulateSessionStart(realProjectRoot)
	})

	async function callToolCall(
		toolName: string,
		input: Record<string, unknown>,
		ui?: FakeCtxOptions["ui"],
	) {
		const ctx = makeCtx(pi, {
			cwd: realProjectRoot,
			ui,
		})
		return pi.simulateToolCall(toolName, input, ctx)
	}

	async function switchMode(mode: string) {
		pi.flags["permission-mode"] = mode
		await pi.simulateSessionStart(realProjectRoot)
	}

	describe("ask mode", () => {
		it("prompts on edit (inside cwd)", async () => {
			await switchMode("ask")
			const result = await callToolCall("edit", { path: "src/foo.ts" }, {
				custom: async () => "Block",
			})
			expect(result).toMatchObject({ block: true })
		})

		it("auto-approves read (inside cwd)", async () => {
			await switchMode("ask")
			const result = await callToolCall("read", { path: "src/foo.ts" })
			expect(result).toBeUndefined()
		})

		it("prompts on read outside cwd", async () => {
			await switchMode("ask")
			const result = await callToolCall("read", { path: "/etc/passwd" })
			expect(result).toMatchObject({ block: true })
		})

		it("auto-approves safe bash", async () => {
			await switchMode("ask")
			const result = await callToolCall("bash", { command: "ls -la" })
			expect(result).toBeUndefined()
		})

		it("prompts on destructive bash", async () => {
			await switchMode("ask")
			const result = await callToolCall("bash", { command: "rm -rf /" }, {
				custom: async () => "Block",
			})
			expect(result).toMatchObject({ block: true })
		})

		it("prompts on grep outside cwd", async () => {
			await switchMode("ask")
			const result = await callToolCall("grep", { path: "/etc/hosts" })
			expect(result).toMatchObject({ block: true })
		})

		it("auto-approves grep inside cwd", async () => {
			await switchMode("ask")
			const result = await callToolCall("grep", { path: "src/foo.ts" })
			expect(result).toBeUndefined()
		})
	})

	describe("plan mode", () => {
		it("blocks edit (defensive — tool is also stripped via setActiveTools)", async () => {
			await switchMode("plan")
			const result = await callToolCall("edit", { path: "src/foo.ts" })
			expect(result).toMatchObject({ block: true })
		})

		it("auto-approves read", async () => {
			await switchMode("plan")
			const result = await callToolCall("read", { path: "src/foo.ts" })
			expect(result).toBeUndefined()
		})

		it("auto-approves safe bash", async () => {
			await switchMode("plan")
			const result = await callToolCall("bash", { command: "ls" })
			expect(result).toBeUndefined()
		})

		it("auto-approves ls tool (including outside cwd)", async () => {
			await switchMode("plan")
			const inside = await callToolCall("ls", { path: "src" })
			expect(inside).toBeUndefined()
			const outside = await callToolCall("ls", { path: "/tmp" })
			expect(outside).toBeUndefined()
		})

		it("enables ls in active tools after entering plan mode", async () => {
			expect(pi.activeTools.includes("ls")).toBe(false)
			await switchMode("plan")
			expect(pi.activeTools).toEqual(
				expect.arrayContaining(["read", "bash", "grep", "find", "ls", "plan_ready"]),
			)
		})

		it("re-applies plan tools on before_agent_start", async () => {
			await switchMode("plan")
			pi.activeTools.length = 0
			pi.activeTools.push("read", "bash")
			const handler = pi.handlers.get("before_agent_start")?.[0]
			expect(handler).toBeDefined()
			await handler!(
				{ systemPrompt: "" },
				makeCtx(pi, { cwd: realProjectRoot, ui: {} }),
			)
			expect(pi.activeTools).toEqual(expect.arrayContaining(["ls", "grep", "find"]))
		})

		it("blocks destructive bash", async () => {
			await switchMode("plan")
			const result = await callToolCall("bash", { command: "rm -rf /" })
			expect(result).toMatchObject({ block: true })
		})
	})

	describe("readonly mode", () => {
		function writeConfig(data: Record<string, unknown>) {
			writeFileSync(
				join(configTmp, "permission-modes.json"),
				JSON.stringify({ classifier: { enabled: false }, ...data }),
			)
		}

		async function enterReadonly(data: Record<string, unknown> = {}) {
			writeConfig(data)
			pi.flags["permission-mode"] = "readonly"
			await pi.simulateSessionStart(realProjectRoot)
		}

		it("removes edit/write from the active tool set", async () => {
			await enterReadonly()
			expect(pi.activeTools).not.toContain("edit")
			expect(pi.activeTools).not.toContain("write")
			expect(pi.activeTools).toEqual(
				expect.arrayContaining(["read", "bash", "grep", "find"]),
			)
		})

		it("restores edit/write by name when leaving read-only", async () => {
			await enterReadonly()
			await switchMode("ask")
			expect(pi.activeTools).toEqual(expect.arrayContaining(["edit", "write"]))
		})

		it("does not clobber tools another extension activated meanwhile", async () => {
			await enterReadonly()
			pi.addTool("web_search", "npm:pi-web-access")
			pi.activeTools.push("web_search")
			await switchMode("ask")
			expect(pi.activeTools).toEqual(
				expect.arrayContaining(["edit", "write", "web_search"]),
			)
		})

		it("keeps the plan snapshot intact across readonly → plan → ask", async () => {
			await switchMode("plan")
			await enterReadonly()
			await switchMode("plan")
			await switchMode("ask")
			expect(pi.activeTools).toEqual(expect.arrayContaining(["edit", "write"]))
			expect(pi.activeTools).not.toContain("plan_ready")
		})

		it("re-hides edit/write on every turn", async () => {
			await enterReadonly()
			pi.activeTools.push("edit", "write")
			const handler = pi.handlers.get("before_agent_start")?.[0]
			expect(handler).toBeDefined()
			await handler!({ systemPrompt: "" }, makeCtx(pi, { cwd: realProjectRoot }))
			expect(pi.activeTools).not.toContain("edit")
			expect(pi.activeTools).not.toContain("write")
		})

		it("blocks edit and write with an actionable reason", async () => {
			await enterReadonly()
			const edit = await callToolCall("edit", { path: "src/foo.ts" })
			expect(edit).toMatchObject({ block: true })
			expect((edit as { reason: string }).reason).toContain("Read Only mode")
			expect((edit as { reason: string }).reason).toContain("/ask")
			expect(await callToolCall("write", { path: "src/foo.ts" })).toMatchObject({
				block: true,
			})
		})

		it("allows read tools, including outside cwd, without prompting", async () => {
			await enterReadonly()
			expect(await callToolCall("read", { path: "/etc/passwd" })).toBeUndefined()
			expect(await callToolCall("grep", { path: "/etc" })).toBeUndefined()
			expect(await callToolCall("find", { path: "/tmp" })).toBeUndefined()
			expect(await callToolCall("ls", { path: "/tmp" })).toBeUndefined()
		})

		it("allows read-only bash and blocks mutating bash", async () => {
			await enterReadonly()
			expect(await callToolCall("bash", { command: "git status" })).toBeUndefined()
			const rm = await callToolCall("bash", { command: "rm -rf /tmp/x" })
			expect(rm).toMatchObject({ block: true })
			expect((rm as { reason: string }).reason).toContain("read-only commands only")
			expect(
				await callToolCall("bash", { command: "echo hi > out.txt" }),
			).toMatchObject({ block: true })
		})

		it("blocks powershell (no dedicated support this release)", async () => {
			await enterReadonly()
			const result = await callToolCall("powershell", { command: "Get-ChildItem" })
			expect(result).toMatchObject({ block: true })
		})

		it("denies unknown extension tools by default and explains how to allow them", async () => {
			pi.addTool("mcp__foo__bar", "npm:some-mcp")
			await enterReadonly()
			const result = await callToolCall("mcp__foo__bar", {})
			expect(result).toMatchObject({ block: true })
			expect((result as { reason: string }).reason).toContain("npm:some-mcp")
			expect((result as { reason: string }).reason).toContain("readonly.allowPlugins")
		})

		it("allows tools from an allowlisted plugin", async () => {
			const names = [
				"web_enable",
				"web_search",
				"fetch_content",
				"get_search_content",
			]
			for (const name of names) pi.addTool(name, "npm:pi-web-access")
			await enterReadonly({ readonly: { allowPlugins: ["pi-web-access"] } })
			for (const name of names) {
				expect(await callToolCall(name, { query: "x" })).toBeUndefined()
			}
		})

		it("accepts the full npm source as the allowlist entry", async () => {
			pi.addTool("web_search", "npm:pi-web-access")
			await enterReadonly({ readonly: { allowPlugins: ["npm:pi-web-access"] } })
			expect(await callToolCall("web_search", {})).toBeUndefined()
		})

		it("does not let a short name exempt another plugin", async () => {
			pi.addTool("web_search", "npm:pi-web-access")
			await enterReadonly({ readonly: { allowPlugins: ["pi"] } })
			expect(await callToolCall("web_search", {})).toMatchObject({ block: true })
		})

		it("still blocks edit/write when a plugin is allowlisted", async () => {
			await enterReadonly({ readonly: { allowPlugins: ["pi-web-access"] } })
			expect(await callToolCall("edit", { path: "a.ts" })).toMatchObject({
				block: true,
			})
		})

		it("ignores allow rules for writes and mutating bash", async () => {
			await enterReadonly({
				permissions: { allow: ["Edit", "Write", "Bash"] },
			})
			expect(await callToolCall("edit", { path: "src/foo.ts" })).toMatchObject({
				block: true,
			})
			expect(await callToolCall("bash", { command: "rm -rf /tmp/x" })).toMatchObject({
				block: true,
			})
		})

		it("still honors deny rules", async () => {
			await enterReadonly({ permissions: { deny: ["Read"] } })
			const result = await callToolCall("read", { path: "src/foo.ts" })
			expect(result).toMatchObject({ block: true })
			expect((result as { reason: string }).reason).toContain(
				"Denied by permission rule",
			)
		})

		it("does not create a plan file", async () => {
			const planPath = getPlanFilePath(realProjectRoot)
			rmSync(planPath, { force: true })
			await enterReadonly()
			expect(existsSync(planPath)).toBe(false)
		})

		it("registers /readonly and switches mode", async () => {
			const ctx = makeCtx(pi, { cwd: realProjectRoot })
			await pi.simulateCommand("readonly", "", ctx)
			const last = pi.appendEntries[pi.appendEntries.length - 1]
			expect((last.data as { currentMode: string }).currentMode).toBe("readonly")
		})

		it("is listed by /mode", async () => {
			let seen: readonly string[] = []
			const ctx = makeCtx(pi, {
				cwd: realProjectRoot,
				ui: {
					custom: selectorCustom((options) => {
						seen = options
						return undefined
					}),
				},
			})
			await pi.simulateCommand("mode", "", ctx)
			expect(seen).toContain("Read Only")
		})

		it("restores readonly from session state", async () => {
			const ctx = {
				...makeCtx(pi, { cwd: realProjectRoot }),
				sessionManager: {
					getBranch: () => [],
					getGitBranch: () => "",
					getEntries: () => [
						{
							type: "custom",
							customType: "modes",
							data: { currentMode: "readonly" },
						},
					],
				},
			}
			const handler = pi.handlers.get("session_start")?.[0]
			expect(handler).toBeDefined()
			await handler!({}, ctx)
			expect(pi.activeTools).not.toContain("edit")
			expect(pi.activeTools).not.toContain("write")
		})
	})

	describe("plan_ready tool", () => {
		let tmpCwd: string

		function makePlanBody(lineCount: number, suffix = ""): string {
			const steps = Array.from(
				{ length: lineCount },
				(_, i) => `${i + 1}. Implement feature number ${i + 1}${suffix}`,
			).join("\n")
			return `**Plan:**\n${steps}`
		}

		beforeEach(() => {
			tmpCwd = mkdtempSync(join(tmpdir(), "pi-plan-ready-"))
		})

		afterEach(() => {
			rmSync(tmpCwd, { recursive: true, force: true })
		})

		it("uses ui.custom instead of stuffing plan content into ui.select title", async () => {
			await switchMode("plan")
			writePlanFile(tmpCwd, makePlanBody(200, " " + "x".repeat(80)))

			let selectCalled = false
			let customCalled = false
			let customPlanContent = ""

			const ctx = makeCtx(pi, {
				cwd: tmpCwd,
				ui: {
					select: async (title) => {
						selectCalled = true
						expect(title.length).toBeLessThan(200)
						return "Execute the plan"
					},
					custom: async (factory) => {
						customCalled = true
						const mockTui = {
							terminal: {
								rows: 24,
								columns: 80,
								write: () => {},
							},
							requestRender: () => {},
						}
						const mockTheme = {
							fg: (_role: string, text: string) => text,
							bold: (text: string) => text,
							italic: (text: string) => text,
							strikethrough: (text: string) => text,
							underline: (text: string) => text,
						}
						const component = await (factory as Function)(mockTui, mockTheme, {}, () => {})
						customPlanContent = component.render(80).join("\n")
						return "execute"
					},
				},
			})

			const result = await pi.simulateRegisteredTool("plan_ready", { summary: "Ship it" }, ctx)

			expect(customCalled).toBe(true)
			expect(selectCalled).toBe(false)
			expect(customPlanContent).toContain("Plan ready")
			expect(customPlanContent).toContain("Implement feature")
			expect(result).toMatchObject({ terminate: true })
			expect(pi.sentMessages.some((m) => m.message.customType === "modes-execute")).toBe(true)
		})

		it("refine opens editor and submits a follow-up user message", async () => {
			await switchMode("plan")
			writePlanFile(tmpCwd, makePlanBody(5))

			let editorCalled = false
			const ctx = makeCtx(pi, {
				cwd: tmpCwd,
				ui: {
					custom: async () => "refine",
					editor: async (title) => {
						editorCalled = true
						expect(title).toBe("Refine the plan:")
						return "Please add rollback steps"
					},
				},
			})

			const result = await pi.simulateRegisteredTool("plan_ready", {}, ctx)
			expect(editorCalled).toBe(true)
			expect(result).toMatchObject({ terminate: true })
			expect(pi.userMessages).toEqual([
				expect.objectContaining({
					text: "Please add rollback steps",
					opts: { deliverAs: "followUp" },
				}),
			])
		})

		it("stay and cancel close the dialog without triggering execution", async () => {
			await switchMode("plan")
			writePlanFile(tmpCwd, makePlanBody(3))

			for (const choice of ["stay", "cancel"] as const) {
				pi.userMessages.length = 0
				pi.sentMessages.length = 0

				const ctx = makeCtx(pi, {
					cwd: tmpCwd,
					ui: {
						custom: async () => choice,
					},
				})

				const result = await pi.simulateRegisteredTool("plan_ready", {}, ctx)
				expect(result).toMatchObject({ terminate: true })
				expect(pi.userMessages).toHaveLength(0)
				expect(pi.sentMessages.some((m) => m.message.customType === "modes-execute")).toBe(false)
			}
		})
	})



	describe("auto mode", () => {
		it("auto-approves edit inside cwd", async () => {
			await switchMode("auto")
			const result = await callToolCall("edit", { path: "src/foo.ts" })
			expect(result).toBeUndefined()
		})

		it("auto-approves in-cwd edits without prompt", async () => {
			await switchMode("auto")
			const result = await callToolCall("edit", { path: "src/foo.ts" })
			expect(result).toBeUndefined()
		})

		it("prompts on destructive bash (tier 3)", async () => {
			await switchMode("auto")
			const result = await callToolCall("bash", { command: "rm -rf ./build" })
			expect(result).toMatchObject({ block: true })
		})

		it("allows destructive bash when user approves", async () => {
			await switchMode("auto")
			const result = await callToolCall(
				"bash",
				{ command: "rm .marker" },
				{ custom: async () => "Allow" },
			)
			expect(result).toBeUndefined()
		})

		it("prompts on write outside cwd (tier 3)", async () => {
			await switchMode("auto")
			const result = await callToolCall("write", { path: "/tmp/outside.txt" })
			expect(result).toMatchObject({ block: true })
		})

		it("allows write outside cwd when user approves", async () => {
			await switchMode("auto")
			const result = await callToolCall(
				"write",
				{ path: "/tmp/outside.txt" },
				{ custom: async () => "Allow" },
			)
			expect(result).toBeUndefined()
		})

		it("prompts on curl bash (tier 3)", async () => {
			await switchMode("auto")
			const result = await callToolCall("bash", {
				command: "curl https://example.com",
			})
			expect(result).toMatchObject({ block: true })
		})

		it("prompts on npm install (tier 3)", async () => {
			await switchMode("auto")
			const result = await callToolCall("bash", {
				command: "npm install lodash",
			})
			expect(result).toMatchObject({ block: true })
		})

		it("prompts on dangerous bash not covered by auto-approvable", async () => {
			await switchMode("auto")
			const result = await callToolCall("bash", {
				command: "rm -rf node_modules",
			})
			expect(result).toMatchObject({ block: true })
		})

		it("auto-approves safe read-only bash inside tier-3", async () => {
			await switchMode("auto")
			const result = await callToolCall("bash", { command: "ls -la" })
			expect(result).toBeUndefined()
		})

		it("auto-approves safe read-only bash (node --version)", async () => {
			await switchMode("auto")
			const result = await callToolCall("bash", {
				command: "node --version",
			})
			expect(result).toBeUndefined()
		})

		it("still prompts on safe+mutating compound bash", async () => {
			await switchMode("auto")
			const result = await callToolCall("bash", {
				command: "grep foo bar & npm i",
			})
			expect(result).toMatchObject({ block: true })
		})

		it("auto-approves npm test in fallback path", async () => {
			await switchMode("auto")
			const result = await callToolCall("bash", { command: "npm test" })
			expect(result).toBeUndefined()
		})

		it("auto-approves read outside cwd for non-sensitive paths", async () => {
			await switchMode("auto")
			const result = await callToolCall("read", { path: "/etc/passwd" })
			expect(result).toBeUndefined()
		})

		it("prompts on read of sensitive paths", async () => {
			await switchMode("auto")
			const result = await callToolCall("read", { path: ".git/config" })
			expect(result).toMatchObject({ block: true })
		})

		it("prompts on bash touching .git", async () => {
			await switchMode("auto")
			const result = await callToolCall("bash", {
				command: "cat .git/config",
			})
			expect(result).toMatchObject({ block: true })
		})

		it("fail-closed when classifier is unavailable", async () => {
			writeFileSync(
				join(configTmp, "permission-modes.json"),
				JSON.stringify({
					classifier: {
						enabled: true,
						model: "test/missing-model",
						timeoutMs: 1000,
						failClosed: true,
					},
				}),
			)
			await switchMode("auto")
			const risky = await callToolCall("bash", {
				command: "npm install lodash",
			})
			expect(risky).toMatchObject({ block: true })
			expect(String((risky as { reason?: string })?.reason)).toContain(
				"temporarily unavailable",
			)
		})
	})

	describe("permission rules", () => {
		let configTmp: string

		beforeEach(() => {
			configTmp = mkdtempSync(join(tmpdir(), "pm-idx-perm-"))
			setConfigPath(join(configTmp, "permission-modes.json"))
			writeFileSync(
				join(configTmp, "permission-modes.json"),
				JSON.stringify({ classifier: { enabled: false } }),
			)
		})

		it("allow rule bypasses auto-mode prompt for matching bash", async () => {
			writeProjectPermissionsFile(realProjectRoot, {
				allow: ["Bash(npm install *)"],
			})
			await pi.simulateSessionStart(realProjectRoot)
			await switchMode("auto")
			const result = await callToolCall("bash", {
				command: "npm install -g @scope/pkg",
			})
			expect(result).toBeUndefined()
		})

		it("deny rule blocks before mode gate", async () => {
			writeProjectPermissionsFile(realProjectRoot, {
				deny: ["Bash(curl *)"],
			})
			await pi.simulateSessionStart(realProjectRoot)
			await switchMode("auto")
			const result = await callToolCall("bash", {
				command: "curl https://example.com",
			})
			expect(result).toMatchObject({ block: true })
			expect(String((result as { reason?: string })?.reason)).toContain(
				"Denied by permission rule",
			)
		})

		it("strips dangerous Bash allow rules in auto mode", async () => {
			writeProjectPermissionsFile(realProjectRoot, {
				allow: ["Bash(python:*)", "Bash(npm install *)"],
			})
			await pi.simulateSessionStart(realProjectRoot)
			await switchMode("auto")
			const viaSpecificAllow = await callToolCall(
				"bash",
				{ command: "npm install -g @scope/pkg" },
			)
			expect(viaSpecificAllow).toBeUndefined()
			const python = await callToolCall(
				"bash",
				{ command: 'python -c "print(1)"' },
			)
			expect(python).toMatchObject({ block: true })
		})
	})

	describe("bypass mode", () => {
		it("auto-approves destructive bash", async () => {
			await switchMode("bypass")
			const result = await callToolCall("bash", { command: "rm -rf ./build" })
			expect(result).toBeUndefined()
		})

		it("auto-approves write outside cwd", async () => {
			await switchMode("bypass")
			const result = await callToolCall("write", { path: "/tmp/outside.txt" })
			expect(result).toBeUndefined()
		})
	})
})

describe("permission-modes extension: permission feedback option", () => {
	let pi: FakePi
	let realProjectRoot: string
	let configTmp: string

	const FEEDBACK_LABEL = "No, and tell the agent what to do differently"

	beforeEach(async () => {
		pi = createFakePi()
		configTmp = mkdtempSync(join(tmpdir(), "pm-fb-cfg-"))
		setConfigPath(join(configTmp, "permission-modes.json"))
		writeFileSync(
			join(configTmp, "permission-modes.json"),
			JSON.stringify({ classifier: { enabled: false } }),
		)
		realProjectRoot = process.cwd()
		permissionModesExtension(makeFakePiForExtension(pi))
		await pi.simulateSessionStart(realProjectRoot)
	})

	afterEach(() => {
		rmSync(configTmp, { recursive: true, force: true })
	})

	async function callToolCall(
		toolName: string,
		input: Record<string, unknown>,
		ui: FakeCtxOptions["ui"],
	) {
		const ctx = makeCtx(pi, { cwd: realProjectRoot, ui })
		return pi.simulateToolCall(toolName, input, ctx)
	}

	it("offers the feedback option as the last entry of the ask-mode selector", async () => {
		let seenOptions: string[] = []
		await callToolCall("bash", { command: "rm -rf /" }, {
			custom: selectorCustom((options) => {
				seenOptions = [...options]
				return "Block"
			}),
		})
		expect(seenOptions).toEqual([
			"Allow",
			"Allow always (this project)",
			"Allow always (global)",
			"Block",
			FEEDBACK_LABEL,
		])
	})

	it("wraps ↑ from the first option to the feedback option and blocks with it", async () => {
		const result = await callToolCall("bash", { command: "rm -rf /" }, {
			custom: async (factory) =>
				new Promise<string | undefined>((resolve) => {
					Promise.resolve(
						(factory as Function)(selectorTui(), selectorTheme(), undefined, resolve),
					).then((component: { handleInput(data: string): void }) => {
						// First option + ↑ must land on the last (feedback) option.
						component.handleInput("\x1b[A")
						component.handleInput("\r")
					})
				}),
			editor: async () => "use the local cache",
		})
		expect(result).toMatchObject({
			block: true,
			reason: expect.stringContaining("User feedback: use the local cache"),
		})
	})

	it("blocks with the feedback text so the model sees it", async () => {
		const result = await callToolCall("bash", { command: "rm -rf /" }, {
			custom: async () => FEEDBACK_LABEL,
			editor: async () => "don't delete system files",
		})
		expect(result).toMatchObject({
			block: true,
			reason: expect.stringContaining("User feedback: don't delete system files"),
		})
	})

	it("passes the tool name to the feedback prompt", async () => {
		let title = ""
		await callToolCall("bash", { command: "rm -rf /" }, {
			custom: async () => FEEDBACK_LABEL,
			editor: async (t) => {
				title = t
				return "use the local cache"
			},
		})
		expect(title).toBe("Tell the agent how to proceed with bash:")
	})

	it("treats empty feedback as a plain block (no feedback in the reason)", async () => {
		const result = await callToolCall("bash", { command: "rm -rf /" }, {
			custom: async () => FEEDBACK_LABEL,
			editor: async () => "   ",
		})
		expect(result).toMatchObject({ block: true, reason: "bash blocked by user" })
	})

	it("treats a cancelled feedback prompt as a plain block", async () => {
		const result = await callToolCall("bash", { command: "rm -rf /" }, {
			custom: async () => FEEDBACK_LABEL,
			editor: async () => undefined,
		})
		expect(result).toMatchObject({ block: true, reason: "bash blocked by user" })
	})

	it("keeps every other option behaviour unchanged", async () => {
		const allowed = await callToolCall("bash", { command: "rm -rf /" }, {
			custom: async () => "Allow",
		})
		expect(allowed).toBeUndefined()

		const blocked = await callToolCall("bash", { command: "rm -rf /" }, {
			custom: async () => "Block",
		})
		expect(blocked).toMatchObject({ block: true, reason: "bash blocked by user" })
	})

	it("works on the ask-mode edit/write gate and keeps the path in the reason", async () => {
		let seenOptions: string[] = []
		const result = await callToolCall("edit", { path: "src/foo.ts" }, {
			custom: selectorCustom((options) => {
				seenOptions = [...options]
				return FEEDBACK_LABEL
			}),
			editor: async () => "edit the file under src/ instead",
		})
		expect(seenOptions).toEqual([
			"Allow",
			"Allow always (this project)",
			"Allow always (global)",
			"Allow all (enable bypass)",
			"Block",
			FEEDBACK_LABEL,
		])
		expect(result).toMatchObject({
			block: true,
			reason: expect.stringContaining(
				"User feedback: edit the file under src/ instead",
			),
		})
	})

	it("works on the outside-cwd read gate", async () => {
		const result = await callToolCall("read", { path: "/etc/passwd" }, {
			custom: async () => FEEDBACK_LABEL,
			editor: async () => "read the local config instead",
		})
		expect(result).toMatchObject({
			block: true,
			reason: expect.stringContaining("User feedback: read the local config instead"),
		})
	})

	it("works on the auto-mode tier-3 prompt", async () => {
		pi.flags["permission-mode"] = "auto"
		await pi.simulateSessionStart(realProjectRoot)
		const result = await callToolCall("read", { path: ".git/config" }, {
			custom: async () => FEEDBACK_LABEL,
			editor: async () => "read the tracked file instead",
		})
		expect(result).toMatchObject({
			block: true,
			reason: expect.stringContaining("User feedback: read the tracked file instead"),
		})
	})
})

describe("permission-modes extension: no auto follow-up (v2.0.0)", () => {
	let pi: FakePi

	beforeEach(() => {
		pi = createFakePi()
	})

	async function simulateTurnEnd(message: unknown) {
		const list = pi.handlers.get("turn_end") ?? []
		for (const h of list) {
			await h({ message }, makeCtx(pi, { cwd: "/home/user/project/src" }))
		}
	}

	it("does NOT send Continue follow-up in auto mode", async () => {
		permissionModesExtension(makeFakePiForExtension(pi))
		await pi.simulateSessionStart("/home/user/project/src")
		pi.flags["permission-mode"] = "auto"
		await pi.simulateSessionStart("/home/user/project/src")

		await simulateTurnEnd({
			role: "assistant",
			content: [
				{ type: "text", text: "Working on step 2 now." },
				{ type: "toolCall", name: "bash", input: { command: "ls" } },
			],
		})

		expect(pi.userMessages.length).toBe(0)
	})
})

describe("bypass mode: outside-cwd write tracking", () => {
	let pi: FakePi
	let realProjectRoot: string
	let outsideTmpDir: string
	let outsideFile: string

	async function switchMode(mode: string) {
		pi.flags["permission-mode"] = mode
		await pi.simulateSessionStart(realProjectRoot)
	}

	beforeEach(async () => {
		pi = createFakePi()
		// Use real fs: the current repo IS a project (has package.json).
		realProjectRoot = process.cwd()
		outsideTmpDir = mkdtempSync(join(tmpdir(), "pm-outside-"))
		outsideFile = join(outsideTmpDir, "test.txt")
		permissionModesExtension(makeFakePiForExtension(pi))
		await pi.simulateSessionStart(realProjectRoot)
	})

	afterEach(() => {
		// Clean up any .pi/ artifacts created in realProjectRoot
		const tmpDir = join(realProjectRoot, ".pi", "projects")
		if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true })
		rmSync(outsideTmpDir, { recursive: true, force: true })
	})

	it("auto-approves write outside cwd (no prompt)", async () => {
		await switchMode("bypass")
		const ctx = makeCtx(pi, { cwd: realProjectRoot })
		const result = await pi.simulateToolCall("write", { path: outsideFile }, ctx)
		expect(result).toBeUndefined()
	})

	it("captures backup content of existing file before writing", async () => {
		writeFileSync(outsideFile, "ORIGINAL")
		await switchMode("bypass")
		const ctx = makeCtx(pi, { cwd: realProjectRoot })
		// Write tool_call happens BEFORE the tool actually runs in real pi;
		// in our fake we just call the handler. So pre-write content is "ORIGINAL".
		await pi.simulateToolCall("write", { path: outsideFile }, ctx)
		// Snapshot must exist
		const snaps = listTrackedOutsideWrites(realProjectRoot)
		expect(snaps).toHaveLength(1)
		expect(snaps[0].originalPath).toBe(outsideFile)
		expect(snaps[0].backupContent).toBe("ORIGINAL")
		expect(snaps[0].toolName).toBe("write")
	})

	it("tracks null backup when file did not exist before write", async () => {
		await switchMode("bypass")
		const ctx = makeCtx(pi, { cwd: realProjectRoot })
		await pi.simulateToolCall("write", { path: outsideFile }, ctx)
		const snaps = listTrackedOutsideWrites(realProjectRoot)
		expect(snaps[0].backupContent).toBeNull()
	})

	it("stacks snapshots when same path is written twice", async () => {
		writeFileSync(outsideFile, "FIRST_ORIGINAL")
		await switchMode("bypass")
		const ctx = makeCtx(pi, { cwd: realProjectRoot })
		await pi.simulateToolCall("write", { path: outsideFile }, ctx)
		// The snapshot captures pre-write content
		const snap1 = listTrackedOutsideWrites(realProjectRoot)[0]
		expect(snap1.backupContent).toBe("FIRST_ORIGINAL")

		// Second write — snapshot captures whatever the file had before this write.
		// In the fake, file content is unchanged from after the first call
		// (since we didn't actually write anything). So the new backup matches.
		await new Promise((r) => setTimeout(r, 5))
		await pi.simulateToolCall("write", { path: outsideFile }, ctx)
		const snaps = listTrackedOutsideWrites(realProjectRoot)
		expect(snaps).toHaveLength(2)
		expect(snaps[0].timestamp).not.toBe(snaps[1].timestamp)
	})

	it("does NOT track writes inside cwd", async () => {
		await switchMode("bypass")
		const ctx = makeCtx(pi, { cwd: realProjectRoot })
		await pi.simulateToolCall("write", { path: "src/foo.ts" }, ctx)
		expect(listTrackedOutsideWrites(realProjectRoot)).toEqual([])
	})

	it("notifies user when write is tracked", async () => {
		const notifications: string[] = []
		await switchMode("bypass")
		const ctx = makeCtx(pi, {
			cwd: realProjectRoot,
			ui: { notify: (m: string) => notifications.push(m), custom: async () => "Block" },
		})
		await pi.simulateToolCall("write", { path: outsideFile }, ctx)
		expect(notifications.some((n) => n.includes("tracked"))).toBe(true)
	})

	it("does NOT prompt on outside-cwd write even with strict UI", async () => {
		await switchMode("bypass")
		let prompted = false
		const ctx = makeCtx(pi, {
			cwd: realProjectRoot,
			ui: {
				custom: async () => {
					prompted = true
					return "Block"
				},
				notify: () => {},
			},
		})
		const result = await pi.simulateToolCall("write", { path: outsideFile }, ctx)
		expect(prompted).toBe(false)
		expect(result).toBeUndefined()
	})
})


describe("/outside-writes and /undo-outside-writes commands", () => {
	let pi: FakePi
	let cwd: string
	let outsideDir: string
	let outsideFile: string

	beforeEach(() => {
		pi = createFakePi()
		cwd = mkdtempSync(join(tmpdir(), "pm-cmd-"))
		outsideDir = mkdtempSync(join(tmpdir(), "pm-cmd-out-"))
		outsideFile = join(outsideDir, "outside-target.txt")
		permissionModesExtension(makeFakePiForExtension(pi))
	})

	afterEach(() => {
		rmSync(cwd, { recursive: true, force: true })
		rmSync(outsideDir, { recursive: true, force: true })
	})

	async function setupTrackedWrites() {
		writeFileSync(outsideFile, "ORIGINAL")
		await pi.simulateSessionStart(cwd)
		pi.flags["permission-mode"] = "bypass"
		await pi.simulateSessionStart(cwd)

		// Simulate two tracked writes
		const ctx1 = makeCtx(pi, { cwd })
		await pi.simulateToolCall("write", { path: outsideFile }, ctx1)
		await new Promise((r) => setTimeout(r, 5))
		const ctx2 = makeCtx(pi, { cwd })
		await pi.simulateToolCall("edit", { path: outsideFile }, ctx2)
	}

	it("/outside-writes displays tracked snapshots via sendMessage", async () => {
		await setupTrackedWrites()
		await pi.simulateCommand("outside-writes", "", makeCtx(pi, { cwd }))
		const lastMsg = pi.sentMessages[pi.sentMessages.length - 1]
		expect(lastMsg.message.customType).toBe("outside-writes-list")
		expect(String(lastMsg.message.content)).toContain(outsideFile)
		expect(String(lastMsg.message.content)).toContain("would restore")
	})

	it("/undo-outside-writes --list behaves like /outside-writes", async () => {
		await setupTrackedWrites()
		await pi.simulateCommand("undo-outside-writes", "--list", makeCtx(pi, { cwd }))
		expect(pi.sentMessages.some((m) =>
			m.message.customType === "outside-writes-list"
		)).toBe(true)
	})

	it("/undo-outside-writes list alias also works", async () => {
		await setupTrackedWrites()
		await pi.simulateCommand("undo-outside-writes", "list", makeCtx(pi, { cwd }))
		expect(pi.sentMessages.some((m) =>
			m.message.customType === "outside-writes-list"
		)).toBe(true)
	})

	it("/undo-outside-writes all restores everything and pops all snapshots", async () => {
		await setupTrackedWrites()
		// Simulate that the tool actually wrote something
		writeFileSync(outsideFile, "NEW_CONTENT")
		await pi.simulateCommand("undo-outside-writes", "all", makeCtx(pi, { cwd }))
		// File restored
		expect(readFileSync(outsideFile, "utf-8")).toBe("ORIGINAL")
		// Snapshots popped
		expect(listTrackedOutsideWrites(cwd)).toEqual([])
	})

	it("/undo-outside-writes (no args) shows selector and restores selected", async () => {
		await setupTrackedWrites()
		writeFileSync(outsideFile, "NEW_CONTENT")
		let selectorOptions: string[] = []
		const ctx = makeCtx(pi, {
			cwd,
			ui: {
				custom: selectorCustom((options) => {
					selectorOptions = [...options]
					return options[0]
				}),
				notify: () => {},
			},
		})
		await pi.simulateCommand("undo-outside-writes", "", ctx)
		expect(selectorOptions.length).toBeGreaterThan(0)
		expect(readFileSync(outsideFile, "utf-8")).toBe("ORIGINAL")
	})

	it("/undo-outside-writes handles empty snapshot list gracefully", async () => {
		await pi.simulateSessionStart(cwd)
		const notifications: string[] = []
		await pi.simulateCommand("undo-outside-writes", "all", makeCtx(pi, {
			cwd,
			ui: { notify: (m: string) => notifications.push(m), custom: async () => "Block" },
		}))
		expect(notifications.some((n) => n.includes("No tracked"))).toBe(true)
	})

	it("/undo-outside-writes deletes file when backupContent was null", async () => {
		await pi.simulateSessionStart(cwd)
		pi.flags["permission-mode"] = "bypass"
		await pi.simulateSessionStart(cwd)
		// File didn't exist before write
		await pi.simulateToolCall("write", { path: outsideFile }, makeCtx(pi, { cwd }))
		// Simulate tool creating the file
		writeFileSync(outsideFile, "NEWLY_CREATED")
		await pi.simulateCommand("undo-outside-writes", "all", makeCtx(pi, { cwd }))
		expect(existsSync(outsideFile)).toBe(false)
	})

	it("/outside-writes is available in ask mode too", async () => {
		// Verify the command runs without mode restriction (even in ask mode).
		// Set up in auto mode, then switch to ask
		pi.flags["permission-mode"] = "ask"
		await pi.simulateSessionStart(cwd)
		// In ask mode, outside-writes should not throw
		await expect(
			pi.simulateCommand("outside-writes", "", makeCtx(pi, { cwd }))
		).resolves.not.toThrow()
	})
})

describe("permission-modes: subagent ask forwarding", () => {
	let pi: ReturnType<typeof createFakePi>
	let configTmp: string
	let agentDir: string
	const prevParent = process.env.PI_SUBAGENT_PARENT_SESSION
	const prevChild = process.env.PI_SUBAGENT_CHILD

	beforeEach(() => {
		pi = createFakePi()
		configTmp = mkdtempSync(join(tmpdir(), "pm-fwd-idx-cfg-"))
		agentDir = mkdtempSync(join(tmpdir(), "pm-fwd-idx-agent-"))
		setConfigPath(join(configTmp, "permission-modes.json"))
		writeFileSync(
			join(configTmp, "permission-modes.json"),
			JSON.stringify({ classifier: { enabled: false } }),
		)
		setAgentDirForTests(agentDir)
		delete process.env.PI_SUBAGENT_PARENT_SESSION
		delete process.env.PI_SUBAGENT_CHILD
		permissionModesExtension(makeFakePiForExtension(pi))
	})

	afterEach(() => {
		setAgentDirForTests(undefined)
		rmSync(configTmp, { recursive: true, force: true })
		rmSync(agentDir, { recursive: true, force: true })
		if (prevParent === undefined) delete process.env.PI_SUBAGENT_PARENT_SESSION
		else process.env.PI_SUBAGENT_PARENT_SESSION = prevParent
		if (prevChild === undefined) delete process.env.PI_SUBAGENT_CHILD
		else process.env.PI_SUBAGENT_CHILD = prevChild
		const shutdown = pi.handlers.get("session_shutdown") ?? []
		for (const h of shutdown) void h({}, {})
	})

	it("blocks without parent session when hasUI is false", async () => {
		await pi.simulateSessionStart(process.cwd())
		const ctx = makeCtx(pi, { cwd: process.cwd() }) // no ui → hasUI false
		const result = await pi.simulateToolCall(
			"bash",
			{ command: "rm -rf /tmp/x" },
			ctx,
		)
		expect(result).toMatchObject({
			block: true,
			reason: expect.stringContaining("no UI available"),
		})
	})

	it("fails closed when only PI_SUBAGENT_PARENT_SESSION is set (no PI_SUBAGENT_CHILD)", async () => {
		// Parent env alone is not enough — must also be a subagent child,
		// otherwise unrelated processes that inherit parent env would hang
		// forever waiting for a forwarding response.
		process.env.PI_SUBAGENT_PARENT_SESSION = "stale-parent-id"
		delete process.env.PI_SUBAGENT_CHILD
		await pi.simulateSessionStart(process.cwd())
		const ctx = makeCtx(pi, { cwd: process.cwd() }) // no ui → hasUI false
		const result = await pi.simulateToolCall(
			"read",
			{ path: "/etc/passwd" },
			ctx,
		)
		expect(result).toMatchObject({
			block: true,
			reason: expect.stringContaining("no UI available"),
		})
	})

	it("allows when parent responds with approved", async () => {
		process.env.PI_SUBAGENT_CHILD = "1"
		process.env.PI_SUBAGENT_PARENT_SESSION = "parent-fwd-1"
		await pi.simulateSessionStart(process.cwd())

		const ctx = {
			...makeCtx(pi, { cwd: process.cwd() }),
			sessionManager: {
				getBranch: () => [],
				getGitBranch: () => "",
				getEntries: () => [],
				getSessionId: () => "child-fwd-1",
			},
		}

		const toolPromise = pi.simulateToolCall(
			"bash",
			{ command: "gh pr view 1" },
			ctx,
		)

		await vi.waitFor(
			async () => {
				const pending = await listPendingRequests(agentDir, "parent-fwd-1")
				expect(pending.length).toBeGreaterThan(0)
			},
			{ timeout: 2000, interval: 20 },
		)

		const pending = await listPendingRequests(agentDir, "parent-fwd-1")
		await writeForwardedResponse(agentDir, "parent-fwd-1", {
			id: pending[0].id,
			challenge: pending[0].challenge,
			approved: true,
			decision: "allow",
			responderSessionId: "parent-fwd-1",
			respondedAt: new Date().toISOString(),
		})

		const result = await toolPromise
		expect(result).toBeUndefined()
	})

	it("blocks when parent responds with deny", async () => {
		process.env.PI_SUBAGENT_CHILD = "1"
		process.env.PI_SUBAGENT_PARENT_SESSION = "parent-fwd-2"
		await pi.simulateSessionStart(process.cwd())

		const ctx = makeCtx(pi, { cwd: process.cwd() })
		const toolPromise = pi.simulateToolCall(
			"bash",
			{ command: "curl http://evil" },
			ctx,
		)

		await vi.waitFor(
			async () => {
				const pending = await listPendingRequests(agentDir, "parent-fwd-2")
				expect(pending.length).toBeGreaterThan(0)
			},
			{ timeout: 2000, interval: 20 },
		)

		const pending = await listPendingRequests(agentDir, "parent-fwd-2")
		await writeForwardedResponse(agentDir, "parent-fwd-2", {
			id: pending[0].id,
			challenge: pending[0].challenge,
			approved: false,
			decision: "block",
			responderSessionId: "parent-fwd-2",
			respondedAt: new Date().toISOString(),
			denialReason: "bash blocked by user",
		})

		const result = await toolPromise
		expect(result).toMatchObject({
			block: true,
			reason: expect.stringContaining("blocked"),
		})
	})

	it("passes the parent's feedback text to the child as the block reason", async () => {
		process.env.PI_SUBAGENT_CHILD = "1"
		process.env.PI_SUBAGENT_PARENT_SESSION = "parent-fwd-fb"
		await pi.simulateSessionStart(process.cwd())

		const ctx = makeCtx(pi, { cwd: process.cwd() })
		const toolPromise = pi.simulateToolCall(
			"bash",
			{ command: "curl http://evil" },
			ctx,
		)

		await vi.waitFor(
			async () => {
				const pending = await listPendingRequests(agentDir, "parent-fwd-fb")
				expect(pending.length).toBeGreaterThan(0)
			},
			{ timeout: 2000, interval: 20 },
		)

		const pending = await listPendingRequests(agentDir, "parent-fwd-fb")
		await writeForwardedResponse(agentDir, "parent-fwd-fb", {
			id: pending[0].id,
			challenge: pending[0].challenge,
			approved: false,
			decision: "block",
			responderSessionId: "parent-fwd-fb",
			respondedAt: new Date().toISOString(),
			denialReason:
				"bash blocked by user. User feedback: use the local fixture instead",
		})

		const result = await toolPromise
		expect(result).toMatchObject({
			block: true,
			reason: expect.stringContaining(
				"User feedback: use the local fixture instead",
			),
		})
	})

	it("sends the child agent name to the parent", async () => {
		process.env.PI_SUBAGENT_CHILD = "1"
		process.env.PI_SUBAGENT_PARENT_SESSION = "parent-fwd-name"
		await pi.simulateSessionStart(process.cwd())

		const ctx = makeCtx(pi, {
			cwd: process.cwd(),
			sessionName: "scout: review the diff",
		})
		const toolPromise = pi.simulateToolCall(
			"bash",
			{ command: "gh pr view 1" },
			ctx,
		)

		await vi.waitFor(
			async () => {
				const pending = await listPendingRequests(agentDir, "parent-fwd-name")
				expect(pending.length).toBeGreaterThan(0)
			},
			{ timeout: 2000, interval: 20 },
		)

		const pending = await listPendingRequests(agentDir, "parent-fwd-name")
		expect(pending[0].requesterAgentName).toBe("scout")

		await writeForwardedResponse(agentDir, "parent-fwd-name", {
			id: pending[0].id,
			challenge: pending[0].challenge,
			approved: false,
			decision: "block",
			responderSessionId: "parent-fwd-name",
			respondedAt: new Date().toISOString(),
			denialReason: "bash blocked by user",
		})
		await toolPromise
	})

	it("parent poller does not start under PI_SUBAGENT_CHILD=1", async () => {
		process.env.PI_SUBAGENT_CHILD = "1"
		process.env.PI_SUBAGENT_PARENT_SESSION = "ignored"
		let selectorCalls = 0
		await pi.simulateSessionStart(process.cwd(), {
			custom: async () => {
				selectorCalls++
				return "Allow"
			},
		})
		await writeForwardedRequest({
			agentDir,
			targetSessionId: "parent-should-not-poll",
			tool: "bash",
			label: "x",
			category: "user-prompt",
			cwd: process.cwd(),
			input: {},
		})
		// Force session id mismatch — even if poller started with wrong id it wouldn't match.
		// Main assert: child process must not open a selector for inbox.
		await new Promise((r) => setTimeout(r, 400))
		expect(selectorCalls).toBe(0)
	})
})

describe("permission-modes: subagent feedback option (parent answers)", () => {
	let pi: ReturnType<typeof createFakePi>
	let configTmp: string
	let agentDir: string
	const prevParent = process.env.PI_SUBAGENT_PARENT_SESSION
	const prevChild = process.env.PI_SUBAGENT_CHILD

	beforeEach(() => {
		pi = createFakePi()
		configTmp = mkdtempSync(join(tmpdir(), "pm-fbfb-cfg-"))
		agentDir = mkdtempSync(join(tmpdir(), "pm-fbfb-agent-"))
		setConfigPath(join(configTmp, "permission-modes.json"))
		writeFileSync(
			join(configTmp, "permission-modes.json"),
			JSON.stringify({ classifier: { enabled: false } }),
		)
		setAgentDirForTests(agentDir)
		delete process.env.PI_SUBAGENT_PARENT_SESSION
		delete process.env.PI_SUBAGENT_CHILD
		permissionModesExtension(makeFakePiForExtension(pi))
	})

	afterEach(() => {
		setAgentDirForTests(undefined)
		rmSync(configTmp, { recursive: true, force: true })
		rmSync(agentDir, { recursive: true, force: true })
		if (prevParent === undefined) delete process.env.PI_SUBAGENT_PARENT_SESSION
		else process.env.PI_SUBAGENT_PARENT_SESSION = prevParent
		if (prevChild === undefined) delete process.env.PI_SUBAGENT_CHILD
		else process.env.PI_SUBAGENT_CHILD = prevChild
		const shutdown = pi.handlers.get("session_shutdown") ?? []
		for (const h of shutdown) void h({}, {})
	})

	/** Drive the parent-side handler through a real forwarded request. */
	async function answerForwardedRequest(opts: {
		choose: (options: readonly string[]) => string | undefined
		editor?: (label: string, val: string) => Promise<string | undefined>
		requesterAgentName?: string
	}) {
		const parentSessionId = "parent-fb-1"
		await pi.simulateSessionStart(
			process.cwd(),
			{ custom: selectorCustom(opts.choose), editor: opts.editor },
			undefined,
			parentSessionId,
		)
		const { id, challenge } = await writeForwardedRequest({
			agentDir,
			targetSessionId: parentSessionId,
			tool: "bash",
			label: '"rm -rf /"',
			category: "user-prompt",
			cwd: process.cwd(),
			input: {},
			...(opts.requesterAgentName
				? { requesterAgentName: opts.requesterAgentName }
				: {}),
		})
		const response = await vi.waitFor(
			async () => {
				const pending = await listPendingRequests(agentDir, parentSessionId)
				expect(pending.length).toBe(0)
				const resp = await readForwardedResponse(agentDir, parentSessionId, id)
				expect(resp).toBeTruthy()
				return resp!
			},
			{ timeout: 3000, interval: 30 },
		)
		return { challenge, response }
	}

	it("offers the feedback option to the parent and forwards the text back", async () => {
		let seenOptions: string[] = []
		const { response } = await answerForwardedRequest({
			choose: (options) => {
				seenOptions = [...options]
				return "No, and tell the subagent what to do differently"
			},
			editor: async () => "use the local test fixture instead",
		})
		expect(seenOptions).toEqual([
			"Allow",
			"Allow always (this project)",
			"Allow always (global)",
			"Block",
			"No, and tell the subagent what to do differently",
		])
		expect(response.approved).toBe(false)
		expect(response.decision).toBe("block")
		expect(response.denialReason).toContain(
			"User feedback: use the local test fixture instead",
		)
	})

	it("addresses the subagent by name when the request carries one", async () => {
		let seenOptions: string[] = []
		let title = ""
		const { response } = await answerForwardedRequest({
			choose: (options) => {
				seenOptions = [...options]
				return "No, and tell scout what to do differently"
			},
			editor: async (t) => {
				title = t
				return "read the fixture"
			},
			requesterAgentName: "scout",
		})
		expect(seenOptions).toContain("No, and tell scout what to do differently")
		expect(title).toBe("Tell scout how to proceed with bash:")
		expect(response.denialReason).toContain("User feedback: read the fixture")
	})

	it("treats empty feedback as a plain block", async () => {
		const { response } = await answerForwardedRequest({
			choose: () => "No, and tell the subagent what to do differently",
			editor: async () => "  ",
		})
		expect(response.approved).toBe(false)
		expect(response.denialReason).toBe("bash blocked by user")
	})
})

describe("permission-modes: subagent inherits parent mode", () => {
	let pi: ReturnType<typeof createFakePi>
	let configTmp: string
	const prevChild = process.env.PI_SUBAGENT_CHILD
	const prevInherited = process.env.PERMISSION_MODES_INHERITED_MODE

	beforeEach(() => {
		pi = createFakePi()
		configTmp = mkdtempSync(join(tmpdir(), "pm-inh-cfg-"))
		setConfigPath(join(configTmp, "permission-modes.json"))
		writeFileSync(
			join(configTmp, "permission-modes.json"),
			JSON.stringify({ classifier: { enabled: false } }),
		)
		delete process.env.PI_SUBAGENT_CHILD
		delete process.env.PERMISSION_MODES_INHERITED_MODE
		permissionModesExtension(makeFakePiForExtension(pi))
	})

	afterEach(() => {
		rmSync(configTmp, { recursive: true, force: true })
		if (prevChild === undefined) delete process.env.PI_SUBAGENT_CHILD
		else process.env.PI_SUBAGENT_CHILD = prevChild
		if (prevInherited === undefined)
			delete process.env.PERMISSION_MODES_INHERITED_MODE
		else process.env.PERMISSION_MODES_INHERITED_MODE = prevInherited
	})

	it("child in inherited bypass allows mutating bash without UI", async () => {
		process.env.PI_SUBAGENT_CHILD = "1"
		process.env.PERMISSION_MODES_INHERITED_MODE = "bypass"
		// Default flag is ask — inheritance must override for children.
		pi.flags["permission-mode"] = undefined
		await pi.simulateSessionStart(process.cwd())
		const ctx = makeCtx(pi, { cwd: process.cwd() }) // no ui
		const result = await pi.simulateToolCall(
			"bash",
			{ command: "rm -rf /tmp/x" },
			ctx,
		)
		expect(result).toBeUndefined()
	})

	it("parent setMode publishes inherited env", async () => {
		await pi.simulateSessionStart(process.cwd())
		await pi.simulateCommand("bypass", "", makeCtx(pi, { cwd: process.cwd(), ui: {} }))
		expect(process.env.PERMISSION_MODES_INHERITED_MODE).toBe("bypass")
	})
})

// ---- Configurable shortcuts ----------------------------------------------
//
// Shortcut keys resolve once at factory load from the `shortcuts` block of
// ~/.pi/agent/permission-modes.json. Defaults (shift+tab / alt+t) must
// hold when nothing is configured; individual keys can be overridden,
// normalized to lowercase, or disabled with `null`.

describe("permission-modes extension: configurable shortcuts", () => {
	let pi: FakePi
	let configTmp: string

	beforeEach(() => {
		pi = createFakePi()
		configTmp = mkdtempSync(join(tmpdir(), "pm-idx-sc-"))
		setConfigPath(join(configTmp, "permission-modes.json"))
	})

	function writeConfig(cfg: unknown) {
		writeFileSync(join(configTmp, "permission-modes.json"), JSON.stringify(cfg))
	}

	it("registers the default shortcuts when no shortcuts config exists", () => {
		writeConfig({ classifier: { enabled: false } })
		permissionModesExtension(makeFakePiForExtension(pi))
		expect(pi.shortcuts.has("shift+tab")).toBe(true)
		expect(pi.shortcuts.has("alt+t")).toBe(true)
	})

	it("registers a custom cycleMode key instead of the default", () => {
		writeConfig({ shortcuts: { cycleMode: "ctrl+shift+m" } })
		permissionModesExtension(makeFakePiForExtension(pi))
		expect(pi.shortcuts.has("ctrl+shift+m")).toBe(true)
		expect(pi.shortcuts.has("shift+tab")).toBe(false)
	})

	it("custom cycleMode shortcut cycles modes (ask → readonly)", async () => {
		writeConfig({ shortcuts: { cycleMode: "ctrl+shift+m" } })
		permissionModesExtension(makeFakePiForExtension(pi))
		await pi.simulateSessionStart(process.cwd())
		const notifications: string[] = []
		await pi.simulateShortcut(
			"ctrl+shift+m",
			makeCtx(pi, {
				cwd: process.cwd(),
				ui: {
					notify: (msg: string) => notifications.push(msg),
					custom: async () => "Block",
				},
			}),
		)
		expect(notifications.some((m) => m.includes("Mode: Read Only"))).toBe(true)
	})

	it("normalizes configured keys to lowercase before registering", () => {
		writeConfig({ shortcuts: { cycleMode: "Ctrl+Shift+M" } })
		permissionModesExtension(makeFakePiForExtension(pi))
		expect(pi.shortcuts.has("ctrl+shift+m")).toBe(true)
		expect(pi.shortcuts.has("Ctrl+Shift+M")).toBe(false)
	})

	it("refuses to register unsafe keys like ctrl+m (Enter alias) and warns", () => {
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
		try {
			writeConfig({ shortcuts: { cycleMode: "ctrl+m" } })
			permissionModesExtension(makeFakePiForExtension(pi))
			// ctrl+m must not be registered (it would shadow Enter/submit), and the
			// default cycleMode key must not silently take its place either.
			expect(pi.shortcuts.has("ctrl+m")).toBe(false)
			expect(pi.shortcuts.has("shift+tab")).toBe(false)
			// The remaining safe shortcuts are unaffected.
			expect(pi.shortcuts.has("alt+t")).toBe(true)
			expect(warn.mock.calls.some((c) => String(c[0]).includes("ctrl+m"))).toBe(true)
		} finally {
			warn.mockRestore()
		}
	})
})

// Cycle order follows unattended autonomy, not permission strictness: `ask`
// stops for approval on every write, `readonly` runs a whole turn without
// interruption, so readonly sits right after ask. See
// docs/plan/20261109-0855-mode-cycle-order.md.
describe("permission-modes extension: mode cycle order", () => {
	let pi: FakePi
	let configTmp: string

	beforeEach(async () => {
		pi = createFakePi()
		configTmp = mkdtempSync(join(tmpdir(), "pm-idx-cycle-"))
		setConfigPath(join(configTmp, "permission-modes.json"))
		writeFileSync(
			join(configTmp, "permission-modes.json"),
			JSON.stringify({ classifier: { enabled: false } }),
		)
		permissionModesExtension(makeFakePiForExtension(pi))
		await pi.simulateSessionStart(process.cwd())
	})

	/** Mode persisted by the most recent `setMode()`. */
	function lastMode(): string {
		const last = pi.appendEntries[pi.appendEntries.length - 1]
		return (last.data as { currentMode: string }).currentMode
	}

	function cycleCtx() {
		return makeCtx(pi, {
			cwd: process.cwd(),
			ui: { notify: () => {}, custom: async () => "Block" },
		})
	}

	it("starts in ask (edit/write stay in the tool set), the head of the cycle", () => {
		// Read Only is the only mode that removes edit/write from the tool set at
		// session start, so their presence proves the default mode is ask.
		expect(pi.activeTools).toContain("edit")
		expect(pi.activeTools).toContain("write")
	})

	it("cycles ask → readonly → plan → auto → bypass → ask", async () => {
		const seen: string[] = []
		for (let i = 0; i < 5; i++) {
			await pi.simulateShortcut("shift+tab", cycleCtx())
			seen.push(lastMode())
		}
		expect(seen).toEqual(["readonly", "plan", "auto", "bypass", "ask"])
	})

	it("cycles bypass → ask (was bypass → readonly)", async () => {
		await pi.simulateCommand("bypass", "", makeCtx(pi, { cwd: process.cwd(), ui: {} }))
		expect(lastMode()).toBe("bypass")
		await pi.simulateShortcut("shift+tab", cycleCtx())
		expect(lastMode()).toBe("ask")
	})

	it("lists modes in cycle order in the /mode selector", async () => {
		let seen: readonly string[] = []
		await pi.simulateCommand(
			"mode",
			"",
			makeCtx(pi, {
				cwd: process.cwd(),
				ui: {
					custom: selectorCustom((options) => {
						seen = options
						return undefined
					}),
				},
			}),
		)
		expect(seen).toEqual(["Ask", "Read Only", "Plan", "Auto", "Bypass"])
	})

	it("still maps each selector row to its mode after reordering", async () => {
		await pi.simulateCommand(
			"mode",
			"",
			makeCtx(pi, {
				cwd: process.cwd(),
				ui: { custom: selectorCustom(() => "Read Only") },
			}),
		)
		expect(lastMode()).toBe("readonly")
	})

	it("documents modes in cycle order in the /mode description", () => {
		expect(pi.commandDescriptions.get("mode")).toContain(
			"(ask | readonly | plan | auto | bypass)",
		)
	})
})
