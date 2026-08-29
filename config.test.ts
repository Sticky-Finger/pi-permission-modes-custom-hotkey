/**
 * Unit tests for `config.ts` — shortcut resolution for
 * `~/.pi/agent/permission-modes.json`.
 *
 * Pure-function tests: `resolveShortcuts` is exercised with in-memory config
 * objects only (no fs), covering defaults, overrides, normalization, and
 * disable-via-null.
 */

import { describe, expect, it } from "vitest"

import {
	DEFAULT_SHORTCUTS,
	resolveShortcuts,
	type PermissionModesConfig,
} from "./config.ts"

describe("resolveShortcuts", () => {
	it("falls back to defaults when config is empty", () => {
		expect(resolveShortcuts({})).toEqual({
			cycleMode: "shift+tab",
			cycleThinking: "alt+t",
			cycleProfile: "alt+i",
		})
	})

	it("falls back to defaults when shortcuts is omitted", () => {
		const config: PermissionModesConfig = { classifier: { enabled: false } }
		expect(resolveShortcuts(config)).toEqual(DEFAULT_SHORTCUTS)
	})

	it("overrides individual keys without touching the others", () => {
		const resolved = resolveShortcuts({
			shortcuts: { cycleMode: "ctrl+shift+m" },
		})
		expect(resolved.cycleMode).toBe("ctrl+shift+m")
		expect(resolved.cycleThinking).toBe("alt+t")
		expect(resolved.cycleProfile).toBe("alt+i")
	})

	it("normalizes case and surrounding whitespace", () => {
		const resolved = resolveShortcuts({
			shortcuts: { cycleMode: "  Shift+Tab  ", cycleThinking: "Alt+T" },
		})
		expect(resolved.cycleMode).toBe("shift+tab")
		expect(resolved.cycleThinking).toBe("alt+t")
	})

	it("null disables a shortcut", () => {
		const resolved = resolveShortcuts({
			shortcuts: { cycleProfile: null },
		})
		expect(resolved.cycleProfile).toBeNull()
		expect(resolved.cycleMode).toBe("shift+tab")
	})

	it("empty or whitespace-only string disables a shortcut", () => {
		const resolved = resolveShortcuts({
			shortcuts: { cycleMode: "   " },
		})
		expect(resolved.cycleMode).toBeNull()
	})

	it("ignores unknown shortcut fields", () => {
		const resolved = resolveShortcuts({
			shortcuts: {
				cycleMode: "ctrl+k",
				unknownField: "whatever",
			} as PermissionModesConfig["shortcuts"],
		})
		expect(resolved.cycleMode).toBe("ctrl+k")
		expect(resolved).not.toHaveProperty("unknownField")
	})
})
