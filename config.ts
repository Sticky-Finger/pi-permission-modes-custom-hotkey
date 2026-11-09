/**
 * Permission-modes extension config (`~/.pi/agent/permission-modes.json`).
 * Pure fs helpers — no pi dependency.
 */

import { existsSync, readFileSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"

import type { AutoModeRules } from "./classifier-prompt.ts"

export type ClassifierStage = "tool" | "single" | "fast" | "both" | "thinking"

export const CLASSIFIER_STAGE_SUFFIXES: readonly ClassifierStage[] = [
	"tool",
	"single",
	"fast",
	"both",
	"thinking",
] as const

export interface ClassifierConfig {
	enabled: boolean
	model: string
	timeoutMs: number
	/** CC-style JSONL transcript lines instead of "User:" / "bash cmd" format. */
	jsonlTranscript?: boolean
	/** When true (default), classifier errors deny the action instead of local fallback. */
	failClosed?: boolean
	/** Classifier pipeline — see docs/prompts/auto-mode-prompts.md. Default `tool`. */
	stage?: ClassifierStage
	/** Inject AGENTS.md / CLAUDE.md into classifier context. */
	includeAgentsMd?: boolean
}

export interface ShortcutConfig {
	/** Cycle permission mode forward (ask → readonly → plan → auto → bypass). Default "shift+tab". `null` disables. */
	cycleMode: string | null
	/**
	 * Cycle permission mode backward (bypass → auto → plan → readonly → ask).
	 * Default `null` = opt-in: unset and `null` both mean "not registered",
	 * and no warning is produced for an unconfigured reverse shortcut.
	 */
	cycleModeReverse: string | null
	/** Cycle thinking level. Default "alt+t". `null` disables. */
	cycleThinking: string | null
}

export const DEFAULT_SHORTCUTS: Readonly<Record<keyof ShortcutConfig, string | null>> = {
	cycleMode: "shift+tab",
	cycleModeReverse: null,
	cycleThinking: "alt+t",
} as const

function normalizeShortcutKey(
	key: string | null | undefined,
	fallback: string | null,
): string | null {
	if (key === null) return null
	if (typeof key !== "string") return fallback
	const normalized = key.trim().toLowerCase()
	return normalized || null
}

export function resolveShortcuts(config: PermissionModesConfig): ShortcutConfig {
	const s = config.shortcuts ?? {}
	return {
		cycleMode: normalizeShortcutKey(s.cycleMode, DEFAULT_SHORTCUTS.cycleMode),
		cycleModeReverse: normalizeShortcutKey(
			s.cycleModeReverse,
			DEFAULT_SHORTCUTS.cycleModeReverse,
		),
		cycleThinking: normalizeShortcutKey(s.cycleThinking, DEFAULT_SHORTCUTS.cycleThinking),
	}
}

/**
 * Keys that collide with terminal control characters or core editor keys.
 *
 * Terminals cannot distinguish these Ctrl combos from single-byte control
 * chars, so pi parses them as the aliased key (e.g. ctrl+m sends CR = Enter,
 * ctrl+i sends HT = Tab) and the extension shortcut would shadow
 * Enter/Tab/Backspace/Escape — including message submit, which bricks the
 * editor. "tab" / "backspace" / "space" are bare editor keys pi does not
 * reserve against extensions.
 */
const UNSAFE_SHORTCUT_KEYS: ReadonlySet<string> = new Set([
	"ctrl+m", // = Enter (CR)
	"ctrl+i", // = Tab (HT)
	"ctrl+j", // = LF
	"ctrl+h", // = Backspace (BS) on most termcaps
	"ctrl+[", // = Escape
	"tab",
	"backspace",
	"space",
])

/**
 * True when `key` must not be registered as an extension shortcut.
 * Also rejects bare (or shift-prefixed) single printable characters, which
 * would intercept normal typing.
 */
export function isUnsafeShortcutKey(key: string): boolean {
	const k = key.trim().toLowerCase()
	if (UNSAFE_SHORTCUT_KEYS.has(k)) return true
	return /^(shift\+)?[a-z0-9]$/.test(k)
}

export interface ReadonlyModeConfig {
	/**
	 * Plugin specs exempted from Read Only mode's default-deny, e.g.
	 * `["pi-web-access"]` or `["npm:pi-web-access"]`. Exact match after
	 * normalization; no substring or glob.
	 */
	allowPlugins?: string[]
}

export interface PermissionModesConfig {
	classifier?: Partial<ClassifierConfig>
	/** CC auto-mode classifier allow / soft_deny / environment bullets. */
	autoMode?: AutoModeRules
	/** Read Only mode (`/readonly`) settings. */
	readonly?: ReadonlyModeConfig
	permissions?: {
		allow?: string[]
		deny?: string[]
		ask?: string[]
	}
	/** Keyboard shortcuts. Defaults: shift+tab / alt+t; reverse cycle is opt-in (`cycleModeReverse`, default null). `null` disables. */
	shortcuts?: Partial<ShortcutConfig>
}

let _configPath = join(homedir(), ".pi", "agent", "permission-modes.json")

export function getConfigPath(): string {
	return _configPath
}

export function setConfigPath(p: string): void {
	_configPath = p
}

const DEFAULT_CLASSIFIER: ClassifierConfig = {
	enabled: true,
	model: "anthropic/claude-haiku-4-5",
	timeoutMs: 15000,
	failClosed: true,
	stage: "tool",
	includeAgentsMd: true,
}

export function resolveClassifierConfig(
	config: PermissionModesConfig,
): ClassifierConfig {
	const c = config.classifier ?? {}
	return {
		enabled: c.enabled ?? DEFAULT_CLASSIFIER.enabled,
		model: c.model ?? DEFAULT_CLASSIFIER.model,
		timeoutMs: c.timeoutMs ?? DEFAULT_CLASSIFIER.timeoutMs,
		jsonlTranscript: c.jsonlTranscript ?? false,
		failClosed: c.failClosed ?? DEFAULT_CLASSIFIER.failClosed,
		stage: c.stage ?? DEFAULT_CLASSIFIER.stage,
		includeAgentsMd: c.includeAgentsMd ?? DEFAULT_CLASSIFIER.includeAgentsMd,
	}
}

export function resolveAutoModeConfig(
	config: PermissionModesConfig,
): AutoModeRules | undefined {
	const rules = config.autoMode
	if (!rules) return undefined
	if (
		!rules.allow?.length &&
		!rules.soft_deny?.length &&
		!rules.environment?.length
	) {
		return undefined
	}
	return rules
}

/**
 * Plugin specs allowed in Read Only mode. Empty by default — Read Only denies
 * every non-builtin tool until the user opts a plugin in.
 */
export function resolveReadonlyAllowPlugins(
	config: PermissionModesConfig,
): string[] {
	const list = config.readonly?.allowPlugins
	if (!Array.isArray(list)) return []
	return list.filter(
		(entry): entry is string => typeof entry === "string" && entry.trim().length > 0,
	)
}

export function loadPermissionModesConfig(): PermissionModesConfig {
	try {
		if (!existsSync(_configPath)) return {}
		const raw = readFileSync(_configPath, "utf-8")
		if (!raw.trim()) return {}
		return JSON.parse(raw) as PermissionModesConfig
	} catch (err) {
		console.warn(
			`[permission-modes] Failed to load ${_configPath}:`,
			err,
		)
		return {}
	}
}
