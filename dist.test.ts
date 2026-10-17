/**
 * Guards for the committed build artifact dist/index.js.
 *
 * These tests encode the hard rules from docs/plan/20261007-2115-dist-bundle.md §2:
 * - single self-contained file (no runtime dependency on third-party packages);
 * - everything inlined is registered (INLINED_THIRD_PARTY inventory);
 * - bytes are reproducible (a rebuild must match the committed file exactly);
 * - size budget and no environment leakage.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { gzipSync } from "node:zlib"
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs"
import { homedir, tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import {
	INLINED_THIRD_PARTY,
	buildBundle,
	checkImportWhitelist,
	collectImportSpecifiers,
	collectInlinedThirdParty,
} from "./scripts/build.js"

const ROOT = dirname(fileURLToPath(import.meta.url))
const DIST_DIR = join(ROOT, "dist")
const DIST_FILE = join(DIST_DIR, "index.js")
const PACKAGE_JSON = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"))

const SIZE_BUDGET_BYTES = 90 * 1024
const SIZE_BUDGET_GZIP_BYTES = 32 * 1024

const PROMPT_FILES = [
	"classifier-prompts/auto_mode_system_prompt.txt",
	"classifier-prompts/permissions_external.txt",
]

let tmpDir: string
let rebuilt: Awaited<ReturnType<typeof buildBundle>>
let committedCode: string

function normalize(text: string): string {
	return text.replace(/\r\n/g, "\n")
}

/** Long ASCII-only lines without quotes — safe to assert as escaped string-literal fragments. */
function sampleLines(text: string): string[] {
	const candidates = text
		.split("\n")
		.map((line) => line.trim())
		.filter(
			(line) =>
				line.length > 30 && !line.includes('"') && /^[\x20-\x7E]+$/.test(line),
		)
	expect(candidates.length).toBeGreaterThanOrEqual(3)
	return [
		candidates[0] as string,
		candidates[Math.floor(candidates.length / 2)] as string,
		candidates[candidates.length - 1] as string,
	]
}

beforeAll(async () => {
	tmpDir = mkdtempSync(join(tmpdir(), "permission-modes-dist-"))
	committedCode = readFileSync(DIST_FILE, "utf8")
	// Fresh rebuild into a temp dir: must be byte-identical to the committed artifact.
	// (Deterministic output is what makes "audited once, stable forever" hold.)
	rebuilt = await buildBundle({ outfile: join(tmpDir, "index.js"), minify: true })
})

afterAll(() => {
	rmSync(tmpDir, { recursive: true, force: true })
})

describe("dist artifact", () => {
	it("contains exactly one file: index.js", () => {
		expect(readdirSync(DIST_DIR)).toEqual(["index.js"])
	})

	it("has no runtime dependencies declared in package.json", () => {
		expect(Object.keys(PACKAGE_JSON.dependencies ?? {})).toEqual([])
	})

	it("stays within the size budget", () => {
		const bytes = statSync(DIST_FILE).size
		const gzipBytes = gzipSync(readFileSync(DIST_FILE)).length
		expect(bytes).toBeLessThanOrEqual(SIZE_BUDGET_BYTES)
		expect(gzipBytes).toBeLessThanOrEqual(SIZE_BUDGET_GZIP_BYTES)
	})

	it("matches a fresh rebuild byte-for-byte (forgot to run npm run build?)", () => {
		expect(normalize(rebuilt.code)).toBe(normalize(committedCode))
	})

	it("imports nothing outside node:*, peerDependencies and @earendil-works/*", () => {
		expect(checkImportWhitelist(committedCode, PACKAGE_JSON)).toEqual([])
		const specifiers = collectImportSpecifiers(committedCode)
		expect(specifiers.length).toBeGreaterThan(0)
		for (const spec of specifiers) {
			expect(spec.startsWith(".")).toBe(false)
		}
	})

	it("inlines no unregistered third-party code", () => {
		expect(collectInlinedThirdParty(rebuilt.metafile)).toEqual(
			[...INLINED_THIRD_PARTY].sort(),
		)
	})

	it("leaks no environment paths or sourcemaps", () => {
		for (const code of [committedCode, rebuilt.code]) {
			expect(code).not.toContain(homedir())
			expect(code).not.toContain(tmpdir())
			expect(code).not.toMatch(/\/(?:home|Users|media)\//)
			expect(code).not.toContain("sourceMappingURL")
		}
	})

	it("inlines both classifier prompts intact", () => {
		for (const file of PROMPT_FILES) {
			const text = readFileSync(join(ROOT, file), "utf8")
			for (const line of sampleLines(text)) {
				const escaped = JSON.stringify(line).slice(1, -1)
				expect(committedCode).toContain(escaped)
			}
		}
	})

	it("loads and default-exports the extension factory", async () => {
		const mod = await import(DIST_FILE)
		expect(typeof mod.default).toBe("function")
	})
})
