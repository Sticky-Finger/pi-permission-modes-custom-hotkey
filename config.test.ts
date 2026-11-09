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
	resolveReadonlyAllowPlugins,
	resolveShortcuts,
	type PermissionModesConfig,
} from "./config.ts"

describe("resolveShortcuts", () => {
	it("falls back to defaults when config is empty", () => {
		expect(resolveShortcuts({})).toEqual({
			cycleMode: "shift+tab",
			cycleModeReverse: null,
			cycleThinking: "alt+t",
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
		expect(resolved.cycleModeReverse).toBeNull()
		expect(resolved.cycleThinking).toBe("alt+t")
	})

	it("leaves the reverse cycle unconfigured (opt-in) by default", () => {
		expect(DEFAULT_SHORTCUTS.cycleModeReverse).toBeNull()
		expect(resolveShortcuts({}).cycleModeReverse).toBeNull()
	})

	it("resolves a configured reverse cycle key", () => {
		const resolved = resolveShortcuts({
			shortcuts: { cycleModeReverse: "Alt+Shift+X" },
		})
		expect(resolved.cycleModeReverse).toBe("alt+shift+x")
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
			shortcuts: { cycleThinking: null, cycleModeReverse: null },
		})
		expect(resolved.cycleThinking).toBeNull()
		expect(resolved.cycleModeReverse).toBeNull()
		expect(resolved.cycleMode).toBe("shift+tab")
	})

	it("empty or whitespace-only string disables a shortcut", () => {
		const resolved = resolveShortcuts({
			shortcuts: { cycleMode: "   ", cycleModeReverse: " " },
		})
		expect(resolved.cycleMode).toBeNull()
		expect(resolved.cycleModeReverse).toBeNull()
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

describe("resolveReadonlyAllowPlugins", () => {
	it("defaults to an empty allowlist", () => {
		expect(resolveReadonlyAllowPlugins({})).toEqual([])
		expect(resolveReadonlyAllowPlugins({ readonly: {} })).toEqual([])
	})

	it("keeps configured plugin specs in order", () => {
		expect(
			resolveReadonlyAllowPlugins({
				readonly: { allowPlugins: ["pi-web-access", "npm:other-plugin"] },
			}),
		).toEqual(["pi-web-access", "npm:other-plugin"])
	})

	it("drops blank and non-string entries", () => {
		expect(
			resolveReadonlyAllowPlugins({
				readonly: {
					allowPlugins: ["pi-web-access", "  ", 42 as unknown as string],
				},
			}),
		).toEqual(["pi-web-access"])
	})

	it("tolerates a malformed allowPlugins value", () => {
		expect(
			resolveReadonlyAllowPlugins({
				readonly: { allowPlugins: "pi-web-access" as unknown as string[] },
			}),
		).toEqual([])
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
