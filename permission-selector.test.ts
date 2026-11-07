import { describe, expect, it } from "vitest"
import type { ExtensionContext, Theme } from "@earendil-works/pi-coding-agent"
import type { TUI } from "@earendil-works/pi-tui"

import {
	computeSelectorMaxVisible,
	createPermissionSelectorComponent,
	showPermissionSelector,
} from "./permission-selector.ts"

const UP = "\x1b[A"
const DOWN = "\x1b[B"

function makeTheme(): Theme {
	return {
		fg: (_role: string, text: string) => text,
		bold: (text: string) => text,
		italic: (text: string) => text,
		strikethrough: (text: string) => text,
		underline: (text: string) => text,
	} as Theme
}

function makeTui(rows = 24, columns = 80): TUI {
	return {
		terminal: {
			rows,
			columns,
			write: () => {},
		},
		requestRender: () => {},
	} as unknown as TUI
}

function createSelector(
	options: string[] = ["Allow", "Block", "No, and tell the agent what to do differently"],
	termRows = 24,
) {
	const state: { result: string | undefined; calls: number } = {
		result: undefined,
		calls: 0,
	}
	const component = createPermissionSelectorComponent({
		title: "Allow bash? \"rm -rf /\"",
		options,
		theme: makeTheme(),
		tui: makeTui(termRows),
		done: (choice) => {
			state.calls++
			state.result = choice
		},
	})
	return { component, state }
}

describe("permission-selector: wrap-around navigation", () => {
	it("wraps from the first option to the last on ↑", () => {
		const { component } = createSelector()
		expect(component.selectedIndex).toBe(0)

		component.handleInput(UP)

		expect(component.selectedIndex).toBe(2)
		expect(component.render(80).join("\n")).toContain(
			"→ No, and tell the agent what to do differently",
		)
	})

	it("wraps from the last option to the first on ↓", () => {
		const { component } = createSelector()

		component.handleInput(DOWN)
		component.handleInput(DOWN)
		expect(component.selectedIndex).toBe(2)

		component.handleInput(DOWN)
		expect(component.selectedIndex).toBe(0)
		expect(component.render(80).join("\n")).toContain("→ Allow")
	})

	it("keeps plain movement unchanged in the middle of the list", () => {
		const { component } = createSelector()

		component.handleInput(DOWN)
		expect(component.selectedIndex).toBe(1)
		component.handleInput(DOWN)
		expect(component.selectedIndex).toBe(2)
		component.handleInput(UP)
		expect(component.selectedIndex).toBe(1)
	})

	it("treats j / k as wrap-around aliases for ↓ / ↑", () => {
		const { component } = createSelector()

		component.handleInput("k")
		expect(component.selectedIndex).toBe(2)
		component.handleInput("j")
		expect(component.selectedIndex).toBe(0)
	})
})

describe("permission-selector: confirm and cancel", () => {
	it("Enter returns the highlighted option", () => {
		const { component, state } = createSelector()
		component.handleInput(DOWN)
		component.handleInput("\r")
		expect(state.result).toBe("Block")
	})

	it("accepts a bare newline as confirm", () => {
		const { component, state } = createSelector()
		component.handleInput("\n")
		expect(state.result).toBe("Allow")
	})

	it("Esc and Ctrl+C cancel with undefined", () => {
		for (const key of ["\x1b", "\x03"]) {
			const { component, state } = createSelector()
			component.handleInput(key)
			expect(state.result).toBeUndefined()
		}
	})

	it("ignores input after the selection is made", () => {
		const { component, state } = createSelector()
		component.handleInput("\r")
		expect(state.result).toBe("Allow")
		component.handleInput(DOWN)
		component.handleInput("\r")
		expect(state.calls).toBe(1)
		expect(state.result).toBe("Allow")
	})
})

describe("permission-selector: layout", () => {
	it("windows long lists to the terminal height and shows a counter", () => {
		const options = Array.from({ length: 30 }, (_, i) => `Option ${i + 1}`)
		const { component } = createSelector(options, 12)

		const lines = component.render(80)
		expect(lines.length).toBeLessThanOrEqual(12)
		expect(lines.join("\n")).toContain("(1/30)")

		// Moving to the last option keeps the selection visible and the
		// rendered height unchanged.
		component.handleInput(UP)
		expect(component.selectedIndex).toBe(29)
		const after = component.render(80)
		expect(after.length).toBeLessThanOrEqual(12)
		expect(after.join("\n")).toContain("→ Option 30")
	})

	it("renders every option when the list fits", () => {
		const { component } = createSelector(["a", "b", "c"], 24)
		const lines = component.render(80)
		expect(lines.join("\n")).toContain("→ a")
		expect(lines.join("\n")).toContain("b")
		expect(lines.join("\n")).toContain("c")
		expect(lines.join("\n")).not.toContain("(1/3)")
	})

	it("reserves title wrap lines so a long prompt stays on screen", () => {
		const title = `Allow bash? "${"x".repeat(300)}"`
		const component = createPermissionSelectorComponent({
			title,
			options: ["Allow", "Block", "Cancel", "Feedback", "More"],
			theme: makeTheme(),
			tui: makeTui(20, 60),
			done: () => {},
		})
		expect(component.render(60).length).toBeLessThanOrEqual(20)
	})

	it("computeSelectorMaxVisible keeps at least one row", () => {
		expect(computeSelectorMaxVisible(24, 6)).toBe(6)
		expect(computeSelectorMaxVisible(10, 20)).toBe(1)
		expect(computeSelectorMaxVisible(1, 20)).toBe(1)
		expect(computeSelectorMaxVisible(24, 0)).toBe(1)
	})
})

describe("showPermissionSelector", () => {
	it("returns undefined without a UI and never opens a dialog", async () => {
		let called = false
		const ctx = {
			hasUI: false,
			mode: "print",
			ui: {
				select: async () => {
					called = true
					return "Allow"
				},
				custom: async () => {
					called = true
					return "Allow"
				},
			},
		} as unknown as ExtensionContext

		expect(await showPermissionSelector(ctx, "Allow?", ["Allow", "Block"])).toBeUndefined()
		expect(called).toBe(false)
	})

	it("keeps the native select path in RPC mode", async () => {
		let customCalled = false
		const ctx = {
			hasUI: true,
			mode: "rpc",
			ui: {
				select: async (_title: string, options: string[]) => options[1],
				custom: async () => {
					customCalled = true
					return "unexpected"
				},
			},
		} as unknown as ExtensionContext

		expect(await showPermissionSelector(ctx, "Allow?", ["Allow", "Block"])).toBe("Block")
		expect(customCalled).toBe(false)
	})

	it("renders the custom selector in TUI mode", async () => {
		let customCalled = false
		let rendered = ""
		const ctx = {
			hasUI: true,
			mode: "tui",
			ui: {
				select: async () => "unexpected",
				custom: async (factory: Function) => {
					customCalled = true
					const component = await factory(makeTui(), makeTheme(), undefined, () => {})
					rendered = component.render(80).join("\n")
					return "Block"
				},
			},
		} as unknown as ExtensionContext

		expect(await showPermissionSelector(ctx, "Allow?", ["Allow", "Block"])).toBe("Block")
		expect(customCalled).toBe(true)
		expect(rendered).toContain("Allow?")
		expect(rendered).toContain("→ Allow")
	})
})
