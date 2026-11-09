/**
 * Read Only mode: plugin allowlisting.
 *
 * Pure helpers — no pi dependency, no fs. `readonly.allowPlugins` entries are
 * matched against a tool's `sourceInfo.source` (stamped by pi at load time),
 * which is the package spec from settings, e.g. `npm:pi-web-access` or
 * `git:https://github.com/owner/repo@main`.
 *
 * Matching is EXACT after normalization — never substring or glob — so a short
 * entry such as `pi` cannot accidentally exempt `pi-web-access` and friends.
 */

/** Built-in tools that only read; always allowed in Read Only mode. */
export const READONLY_READ_TOOLS: ReadonlySet<string> = new Set([
	"read",
	"grep",
	"find",
	"ls",
])

/**
 * Built-in tools that mutate files; removed from the active tool set and
 * always blocked, even if some plugin allowlist entry would match.
 */
export const READONLY_WRITE_TOOLS: ReadonlySet<string> = new Set([
	"edit",
	"write",
])

/**
 * Normalize a plugin spec for comparison: strip scheme prefixes (`npm:`,
 * `git:`, `https:`), a trailing git ref (`#ref` or `@ref`), an npm version
 * suffix (`@1.2.3`, keeping a leading `@scope/`), and a trailing slash.
 */
export function normalizePluginSpec(raw: string | null | undefined): string {
	if (typeof raw !== "string") return ""
	let spec = raw.trim().toLowerCase()
	if (!spec) return ""
	// `git:https://…` carries two prefixes; strip repeatedly.
	for (let i = 0; i < 3; i++) {
		const next = spec.replace(/^(npm|git|github|https?|ssh):/, "")
		if (next === spec) break
		spec = next
	}
	spec = spec.replace(/^\/\//, "")
	spec = spec.replace(/#.*$/, "")
	spec = spec.replace(/\/+$/, "")
	const at = spec.lastIndexOf("@")
	if (at > 0) spec = spec.slice(0, at)
	return spec
}

/**
 * Comparison candidates for one spec: the normalized full string plus its last
 * path segment (so a repo URL matches its repository name). Both are still
 * compared by exact equality.
 */
export function pluginSpecCandidates(
	raw: string | null | undefined,
): string[] {
	const full = normalizePluginSpec(raw)
	if (!full) return []
	const candidates = new Set<string>([full])
	const lastSegment = full.slice(full.lastIndexOf("/") + 1)
	if (lastSegment && lastSegment !== full) candidates.add(lastSegment)
	return [...candidates]
}

/**
 * True when `source` is covered by the configured plugin allowlist.
 * Missing source info or an empty allowlist means "not allowed" (fail closed).
 */
export function isPluginAllowed(
	source: string | null | undefined,
	allowPlugins: readonly string[] | null | undefined,
): boolean {
	if (!allowPlugins?.length) return false
	const allowed = new Set<string>()
	for (const entry of allowPlugins) {
		for (const candidate of pluginSpecCandidates(entry)) allowed.add(candidate)
	}
	if (!allowed.size) return false
	return pluginSpecCandidates(source).some((candidate) => allowed.has(candidate))
}
