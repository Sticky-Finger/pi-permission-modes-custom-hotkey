import { describe, expect, it } from "vitest"

import {
	isPluginAllowed,
	normalizePluginSpec,
	pluginSpecCandidates,
	READONLY_READ_TOOLS,
	READONLY_WRITE_TOOLS,
} from "./readonly-plugins.ts"

describe("readonly-plugins: normalizePluginSpec", () => {
	it("lowercases and trims", () => {
		expect(normalizePluginSpec("  Pi-Web-Access ")).toBe("pi-web-access")
	})

	it("strips the npm: prefix and a version suffix", () => {
		expect(normalizePluginSpec("npm:pi-web-access")).toBe("pi-web-access")
		expect(normalizePluginSpec("npm:pi-web-access@0.35.0")).toBe("pi-web-access")
	})

	it("keeps a scoped package name intact", () => {
		expect(normalizePluginSpec("npm:@scope/pkg@1.2.3")).toBe("@scope/pkg")
		expect(normalizePluginSpec("@scope/pkg")).toBe("@scope/pkg")
	})

	it("strips git scheme, ref, and trailing slash", () => {
		expect(
			normalizePluginSpec("git:https://github.com/owner/repo@main"),
		).toBe("github.com/owner/repo")
		expect(normalizePluginSpec("git:https://github.com/owner/repo#v1.2.0")).toBe(
			"github.com/owner/repo",
		)
		expect(normalizePluginSpec("git:https://github.com/owner/repo/")).toBe(
			"github.com/owner/repo",
		)
	})

	it("returns empty for missing or blank input", () => {
		expect(normalizePluginSpec(undefined)).toBe("")
		expect(normalizePluginSpec(null)).toBe("")
		expect(normalizePluginSpec("   ")).toBe("")
	})
})

describe("readonly-plugins: pluginSpecCandidates", () => {
	it("offers the full spec and its last path segment", () => {
		expect(pluginSpecCandidates("git:https://github.com/owner/repo@main")).toEqual([
			"github.com/owner/repo",
			"repo",
		])
	})

	it("does not duplicate a plain package name", () => {
		expect(pluginSpecCandidates("npm:pi-web-access")).toEqual(["pi-web-access"])
	})
})

describe("readonly-plugins: isPluginAllowed", () => {
	it("is false when the allowlist is empty or missing", () => {
		expect(isPluginAllowed("npm:pi-web-access", [])).toBe(false)
		expect(isPluginAllowed("npm:pi-web-access", undefined)).toBe(false)
	})

	it("matches a package name against a prefixed, versioned source", () => {
		expect(isPluginAllowed("npm:pi-web-access", ["pi-web-access"])).toBe(true)
		expect(isPluginAllowed("npm:pi-web-access@1.0.0", ["pi-web-access"])).toBe(true)
	})

	it("matches a full source entry", () => {
		expect(isPluginAllowed("npm:pi-web-access", ["npm:pi-web-access"])).toBe(true)
	})

	it("matches a git-installed plugin by repository name", () => {
		expect(
			isPluginAllowed("git:https://github.com/owner/pi-web-access@main", [
				"pi-web-access",
			]),
		).toBe(true)
	})

	it("never matches a short prefix of a plugin name", () => {
		expect(isPluginAllowed("npm:pi-web-access", ["pi"])).toBe(false)
		expect(isPluginAllowed("npm:pi-web-access", ["web"])).toBe(false)
		expect(isPluginAllowed("npm:pi-web-access", ["pi-web"])).toBe(false)
	})

	it("is case-insensitive", () => {
		expect(isPluginAllowed("npm:PI-Web-Access", ["Pi-Web-Access"])).toBe(true)
	})

	it("fails closed without source info", () => {
		expect(isPluginAllowed(undefined, ["pi-web-access"])).toBe(false)
		expect(isPluginAllowed("", ["pi-web-access"])).toBe(false)
	})

	it("does not match an unrelated allowlist", () => {
		expect(isPluginAllowed("builtin", ["pi-web-access"])).toBe(false)
	})
})

describe("readonly-plugins: tool classification", () => {
	it("classifies read-only builtins", () => {
		for (const tool of ["read", "grep", "find", "ls"]) {
			expect(READONLY_READ_TOOLS.has(tool)).toBe(true)
			expect(READONLY_WRITE_TOOLS.has(tool)).toBe(false)
		}
	})

	it("classifies mutating builtins", () => {
		for (const tool of ["edit", "write"]) {
			expect(READONLY_WRITE_TOOLS.has(tool)).toBe(true)
			expect(READONLY_READ_TOOLS.has(tool)).toBe(false)
		}
	})

	it("leaves bash and powershell unclassified (handled by the gate)", () => {
		for (const tool of ["bash", "powershell"]) {
			expect(READONLY_READ_TOOLS.has(tool)).toBe(false)
			expect(READONLY_WRITE_TOOLS.has(tool)).toBe(false)
		}
	})
})
