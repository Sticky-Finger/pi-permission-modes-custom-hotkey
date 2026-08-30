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
	isUnsafeShortcutKey,
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

describe("isUnsafeShortcutKey", () => {
	it("flags terminal control-char aliases (pi matches \r for ctrl+m unconditionally)", () => {
		for (const key of ["ctrl+m", "ctrl+i", "ctrl+j", "ctrl+h", "ctrl+["]) {
			expect(isUnsafeShortcutKey(key)).toBe(true)
		}
	})

	it("flags bare editor keys pi does not reserve against extensions", () => {
		for (const key of ["tab", "backspace", "space"]) {
			expect(isUnsafeShortcutKey(key)).toBe(true)
		}
	})

	it("flags bare and shift-prefixed printable characters (typing keys)", () => {
		expect(isUnsafeShortcutKey("a")).toBe(true)
		expect(isUnsafeShortcutKey("1")).toBe(true)
		expect(isUnsafeShortcutKey("shift+a")).toBe(true)
	})

	it("allows safe modifier combos, the defaults, and named keys", () => {
		for (const key of [
			"ctrl+shift+m",
			"alt+m",
			"ctrl+alt+k",
			"shift+tab",
			"alt+t",
			"alt+i",
			"f2",
			"ctrl+space",
		]) {
			expect(isUnsafeShortcutKey(key)).toBe(false)
		}
	})

	it("is case- and whitespace-insensitive", () => {
		expect(isUnsafeShortcutKey("  Ctrl+M ")).toBe(true)
		expect(isUnsafeShortcutKey("Shift+Tab")).toBe(false)
	})
})
