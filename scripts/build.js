#!/usr/bin/env node
/**
 * Build the single-file extension bundle: dist/index.js
 *
 * Design (see docs/plan/20261007-2115-dist-bundle.md):
 * - everything except pi host packages is bundled in (external = peerDependencies + @earendil-works/*);
 * - the two classifier prompt .txt files are inlined via ?raw imports;
 * - after bundling, three gates run and fail the build:
 *     1. import whitelist: only node:*, peerDependencies and @earendil-works/* specifiers allowed;
 *     2. inlined-third-party inventory must match INLINED_THIRD_PARTY exactly;
 *     3. size budget (raw + gzip).
 *
 * Flags: --no-minify (readable build for debugging, do not commit), --report (print module inventory).
 */

import { gzipSync } from "node:zlib"
import { mkdirSync, readFileSync, statSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { build } from "esbuild"

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const PACKAGE_JSON = resolve(ROOT, "package.json")
const ENTRY = resolve(ROOT, "index.ts")
const OUTFILE = resolve(ROOT, "dist/index.js")

/** Raw bytes budget for dist/index.js. Raise only as a deliberate, reviewed decision. */
const SIZE_BUDGET_BYTES = 90 * 1024
/** gzip(level 9) budget for dist/index.js. */
const SIZE_BUDGET_GZIP_BYTES = 32 * 1024

/**
 * Third-party packages intentionally inlined into dist/index.js.
 * Must stay empty unless a package is explicitly reviewed in (supply-chain rule):
 * each entry needs a reason (what it replaces, license, inlined size) recorded here.
 */
export const INLINED_THIRD_PARTY = []

function readPackage() {
	return JSON.parse(readFileSync(PACKAGE_JSON, "utf8"))
}

function hostExternals(pkg) {
	return [...Object.keys(pkg.peerDependencies ?? {}), "@earendil-works/*"]
}

/**
 * Build the bundle. Returns { outfile, code, bytes, gzipBytes, metafile }.
 * Used by `npm run build` and by dist.test.ts (freshness check) so both share identical options.
 */
export async function buildBundle({ outfile = OUTFILE, minify = true } = {}) {
	const pkg = readPackage()
	const result = await build({
		entryPoints: [ENTRY],
		outfile,
		absWorkingDir: ROOT,
		bundle: true,
		format: "esm",
		platform: "node",
		target: "node20",
		minify,
		legalComments: "none",
		loader: { ".txt": "text" },
		external: hostExternals(pkg),
		metafile: true,
		logLevel: "silent",
		sourcemap: false,
	})
	const code = readFileSync(outfile, "utf8")
	return {
		outfile,
		code,
		bytes: statSync(outfile).size,
		gzipBytes: gzipSync(Buffer.from(code, "utf8"), { level: 9 }).length,
		metafile: result.metafile,
		warnings: result.warnings,
	}
}

/** Module specifiers referenced by the bundle (static imports, bare imports, dynamic imports, requires). */
export function collectImportSpecifiers(code) {
	const specifiers = new Set()
	const patterns = [
		/\bfrom\s*"([^"]+)"/g,
		/\bimport\s*"([^"]+)"/g,
		/\bimport\s*\(\s*"([^"]+)"\s*\)/g,
		/\brequire\s*\(\s*"([^"]+)"\s*\)/g,
		/\b__require\s*\(\s*"([^"]+)"\s*\)/g,
	]
	for (const re of patterns) {
		for (const match of code.matchAll(re)) {
			specifiers.add(match[1])
		}
	}
	return [...specifiers].sort()
}

/** Returns the offending specifiers (empty array when the whitelist holds). */
export function checkImportWhitelist(code, pkg) {
	const allowed = new Set(hostExternals(pkg))
	const offending = []
	for (const spec of collectImportSpecifiers(code)) {
		if (spec.startsWith("node:")) continue
		if (spec.startsWith("@earendil-works/")) continue
		if (allowed.has(spec)) continue
		// subpath of an allowed package, e.g. "@earendil-works/pi-ai/compat"
		const base = spec.startsWith("@") ? spec.split("/").slice(0, 2).join("/") : spec.split("/")[0]
		if (allowed.has(base)) continue
		offending.push(spec)
	}
	return offending.sort()
}

/** Package names from node_modules paths that were bundled in (inlined third-party code). */
export function collectInlinedThirdParty(metafile) {
	const names = new Set()
	for (const input of Object.keys(metafile.inputs)) {
		const normalized = input.replace(/\\/g, "/")
		if (!normalized.includes("node_modules/")) continue
		const match = normalized.match(/node_modules\/((?:@[^/]+\/)?[^/]+)/)
		if (match) names.add(match[1])
	}
	return [...names].sort()
}

/** Returns a list of gate failures (empty array = all gates passed). */
export function runGates({ code, bytes, gzipBytes, metafile }, pkg = readPackage()) {
	const failures = []
	const offending = checkImportWhitelist(code, pkg)
	if (offending.length > 0) {
		failures.push(
			`import whitelist: bundle imports non-host package(s): ${offending.join(", ")} ` +
				`(allowed: node:*, ${[...hostExternals(pkg)].join(", ")})`,
		)
	}
	const inlined = collectInlinedThirdParty(metafile)
	const expected = [...INLINED_THIRD_PARTY].sort()
	const unexpected = inlined.filter((name) => !expected.includes(name))
	const missing = expected.filter((name) => !inlined.includes(name))
	if (unexpected.length > 0) {
		failures.push(
			`inlined inventory: third-party code bundled in but not registered in INLINED_THIRD_PARTY: ${unexpected.join(", ")}`,
		)
	}
	if (missing.length > 0) {
		failures.push(
			`inlined inventory: INLINED_THIRD_PARTY lists packages that were not bundled in: ${missing.join(", ")}`,
		)
	}
	if (bytes > SIZE_BUDGET_BYTES) {
		failures.push(`size budget: ${bytes} B > ${SIZE_BUDGET_BYTES} B (raw)`)
	}
	if (gzipBytes > SIZE_BUDGET_GZIP_BYTES) {
		failures.push(`size budget: ${gzipBytes} B > ${SIZE_BUDGET_GZIP_BYTES} B (gzip)`)
	}
	return failures
}

function printReport({ bytes, gzipBytes, metafile }) {
	const inputs = Object.entries(metafile.inputs).sort((a, b) => b[1].bytes - a[1].bytes)
	const thirdParty = collectInlinedThirdParty(metafile)
	console.log(`inputs: ${inputs.length} (${thirdParty.length} third-party)`)
	for (const [path, info] of inputs.slice(0, 12)) {
		console.log(`  ${String(info.bytes).padStart(7)} B  ${path}`)
	}
	if (inputs.length > 12) console.log(`  ... and ${inputs.length - 12} more`)
	if (thirdParty.length > 0) console.log(`inlined third-party: ${thirdParty.join(", ")}`)
	console.log(`size: ${bytes} B raw (budget ${SIZE_BUDGET_BYTES} B, ${Math.round((bytes / SIZE_BUDGET_BYTES) * 100)}%)`)
	console.log(`      ${gzipBytes} B gzip-9 (budget ${SIZE_BUDGET_GZIP_BYTES} B, ${Math.round((gzipBytes / SIZE_BUDGET_GZIP_BYTES) * 100)}%)`)
}

async function main() {
	const minify = !process.argv.includes("--no-minify")
	const report = process.argv.includes("--report")
	mkdirSync(dirname(OUTFILE), { recursive: true })
	const result = await buildBundle({ minify })
	const failures = runGates(result)
	if (report) printReport(result)
	console.log(`built dist/index.js (${result.bytes} B raw / ${result.gzipBytes} B gzip)`)
	for (const warning of result.warnings) console.warn(`esbuild warning: ${warning.text}`)
	if (failures.length > 0) {
		for (const failure of failures) console.error(`GATE FAILED: ${failure}`)
		process.exit(1)
	}
	console.log("gates passed: import whitelist, inlined inventory, size budget")
}

const isDirectRun = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href
if (isDirectRun) {
	main().catch((error) => {
		console.error(error instanceof Error ? error.stack : error)
		process.exit(1)
	})
}
