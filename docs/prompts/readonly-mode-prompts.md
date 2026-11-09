# Read Only Mode — Prompt Reference

> **Part of the v3.2.0 implementation.** Analysis/consulting mode: read everything, change nothing, produce no plan.
> Corresponding code: `MODE_META["readonly"]` + `gateReadonly()` in `index.ts`, `resolveModePrompt()` in `utils.ts`, `readonly-plugins.ts`, `config.ts` (`readonly.allowPlugins`).

---

## 1. Mode metadata

```typescript
// MODE_META["readonly"]
{ icon: "◐", label: "Read Only", role: "success" }
```

- **Slash command:** `/readonly`
- **Cycle position:** `ask → readonly → plan → auto → bypass → ask` (ordered by unattended autonomy, not permission strictness — see [docs/plan/20261109-0855-mode-cycle-order.md](../plan/20261109-0855-mode-cycle-order.md))
- **Flag:** `--permission-mode readonly`
- **Subagent inheritance:** yes (`PERMISSION_MODES_INHERITED_MODE=readonly`)

---

## 2. System context injection

Injected through the `<!-- permission-modes:context -->` anchor every turn. Static — no paths, counters, or per-turn variation:

```
[Read Only] Analysis and consulting mode: inspect and explain, never modify.
- Answer in the conversation; do not create or edit files, and do not write a plan unless the user asks for one.
- If something looks worth changing, describe the change in one or two sentences and stop.
- Do not finish by offering to implement it.
```

Why this wording: the mode exists so the model's attention stays on the user's question. Anything longer (step templates, "first explore, then plan", reminders about plan.md) pulls it back into the plan→implement pipeline that plan mode already provides.

---

## 3. Tool matrix

| Tool | Read Only behavior | Where enforced |
|---|---|---|
| `read`, `grep`, `find`, `ls` | allowed, including outside cwd; never prompts | gate |
| `bash` | allowed only when every segment passes the read-only allowlist and no destructive pattern matches | gate (`isSafeCommand`) |
| `edit`, `write` | removed from the active tool set **and** blocked | `applyReadonlyToolLayer()` + gate |
| `powershell` | blocked (built-in, not in any allowlist) | gate (default-deny) |
| `plan_ready` | blocked; also never in the tool set outside plan mode | gate |
| extension / MCP tools | blocked unless their plugin is allowlisted | gate (`isPluginAllowed`) |

Configured **deny** rules are still evaluated and win. Configured **allow/ask** rules are ignored — Read Only is a hard ceiling, so `allow` cannot widen it and `ask` would only create popups the mode is meant to avoid.

---

## 4. Plugin allowlist (`readonly.allowPlugins`)

```json
{
  "readonly": {
    "allowPlugins": ["pi-web-access"]
  }
}
```

- Default: **empty** — every non-builtin tool is denied.
- Match is against the tool's load-time `sourceInfo.source` (`npm:pi-web-access`, `git:…@ref`, …), **exact after normalization** (lowercase, strip `npm:` / `git:` / `https:` prefixes, version and ref suffixes, trailing slash; also compare the last path segment so a repo URL matches its name).
- No substring, no glob: `pi` does **not** exempt `pi-web-access`.
- Allowlisting is per **plugin**, not per tool: it covers renamed tools, plugin upgrades, and dynamic activation (`web_enable` calling `setActiveTools`). No plugin or tool names are hard-coded in the extension.
- This is a **trust statement**, not a read-only verification: if the allowlisted plugin ships write tools, Read Only does not inspect them.

---

## 5. Differences from plan mode

| Aspect | plan | readonly |
|---|---|---|
| Plan file | created at `.pi/projects/<id>/plan.md`, editable | never created or read |
| Prompt | explore → numbered plan → announce ready | answer the question; no plan unless asked |
| `agent_end` | extracts steps, syncs the plan file, opens the approval dialog | returns immediately |
| Mode switching | "Execute" → auto + `[DONE:n]` tracking | never switches on its own |
| edit / write | in the tool set (gate allows only `plan.md`) | removed from the tool set + blocked |
| Purpose | prepare an implementation | answer a question |

---

## 6. Tool-set management

Read Only never snapshots/restores the whole active set. On entry it removes `edit`/`write` and remembers those names; on exit it adds exactly those names back. This coexists with extensions that rewrite the tool set themselves (e.g. pi-web-access activating web tools): their additions survive, and the write tools are not resurrected by a stale snapshot. `applyToolRestrictions()` re-applies the layer on every `before_agent_start`, so a tool re-added by another extension mid-session is hidden again before the next model turn.

---

## 7. Boundaries

- pi has **no sandbox**: enforcement is tool-call + tool-set level only.
- `bash` relies on the shared read-only allowlist; a crafted command can still slip through the known allowlist gaps (see the plan's risk notes). Read Only reduces accidental writes, it does not contain a hostile model.
- MCP tools (`mcp__<server>__<tool>`) are denied by default; allowlist their server's plugin source if one is genuinely read-only.
- `powershell` is **not** adapted in this release — it is denied here by default-deny, while ask/plan still fall through to allow it. Tracked in [`docs/issues/20261107-powershell-not-gated.md`](../issues/20261107-powershell-not-gated.md).
