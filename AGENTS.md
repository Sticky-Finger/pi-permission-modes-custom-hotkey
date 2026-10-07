# AGENTS.md — permission-modes

Guide for coding agents working in this repository. Product context (goals, users,
features, success metrics): see [docs/PRD.md](docs/PRD.md).

## Summary
A pi extension that implements Claude-Code-style permission modes (ask / plan / auto / bypass) for the pi coding agent, published on npm as `@georgedong32/permission-modes@3.0.0`. It intercepts tool calls, gates approvals per mode, supports CC-compatible **allow/deny/ask** permission rules (global + per-project), injects minimal mode context via a system-prompt anchor, provides an adaptive live footer, guards reads outside cwd in ask mode, supports an optional built-in auto classifier (`completeSimple` via `@earendil-works/pi-ai/compat` + `ctx.modelRegistry` auth), and tracks outside-cwd writes for undo (bypass mode). Switching modes **never** touches the model or thinking level (the model-profile system was removed in v3.0.0 — use pi's native `/model`).

## Tech Stack
- **Language:** TypeScript (ESM — `"type": "module"`)
- **Framework:** Pi coding agent extension API (`@earendil-works/pi-coding-agent`, `@earendil-works/pi-ai`, `@earendil-works/pi-tui`)
- **Package Manager:** npm (no lock file committed)
- **Peer Dependencies:** `@earendil-works/pi-coding-agent`, `@earendil-works/pi-ai`, `@earendil-works/pi-tui`, `typebox`
- **Third-party deps:** None

## Project Structure
```
permission-modes/             # @georgedong32/permission-modes
├── package.json              # pi manifest + npm package metadata
├── index.ts                  # main extension — default-exported factory function
├── classifier-client.ts      # built-in auto classifier (pi-ai completeSimple + modelRegistry auth)
├── config.ts                 # ~/.pi/agent/permission-modes.json loader
├── permissions.ts            # rule evaluation (deny → ask → allow)
├── permissions-loader.ts     # global + project permissions.json merge/persist
├── permission-rule-parser.ts # CC Tool(specifier) parse/serialize
├── shell-rule-matching.ts    # bash exact/prefix/wildcard matching
├── bash-permission-match.ts  # bash compound-command rule matching
├── path-permission-match.ts  # Read/Edit/Write path glob matching
├── utils.ts                  # pure helpers: bash allowlist, Plan: extraction, [DONE:n] tracking
├── index.test.ts             # integration tests (vitest)
├── utils.test.ts             # unit tests for utils (vitest)
├── vitest.config.ts          # vitest configuration
├── CHANGELOG.md              # release history
├── LICENSE                   # MIT
├── .gitignore                # excludes node_modules, package-lock.json, .pi/ artifacts
├── docs/
│   ├── PRD.md                # product requirements (human audience)
│   ├── prompts/              # mode-specific prompt context
│   │   ├── ask-mode-prompts.md
│   │   ├── plan-mode-prompts.md
│   │   └── auto-mode-prompts.md
│   └── suggestions.md        # feature ideas for future versions
├── AGENTS.md                 # this file
├── CLAUDE.md                 # thin pointer → AGENTS.md
└── .pi/
    └── permission-modes-45ea0551.md  # pi project marker (auto-generated)
```

## Commands

### Pi runtime (inside pi after extension loaded)

| Action | Command |
|---|---|
| Switch mode | `/ask`, `/plan`, `/auto`, `/bypass`, or `/mode` (`/default` works as alias) |
| Permission rules | `~/.pi/agent/permission-modes.json` + `<cwd>/.pi/projects/<id>/permissions.json` |
| List permission rules | `/permissions` |
| Classifier config | `~/.pi/agent/permission-modes.json` (`classifier.enabled`, `classifier.model`, `classifier.timeoutMs`) |
| Undo outside-cwd writes | `/undo-outside-writes` (selector, `all`, or `--list`) |
| List outside-cwd writes | `/outside-writes` |
| Shortcut | `Shift+Tab` to cycle modes (default; configurable) |
| Shortcut | `Alt+T` to cycle thinking level (default; configurable) |
| Shortcut config | `shortcuts` block in `~/.pi/agent/permission-modes.json` (`cycleMode` / `cycleThinking`; `null` disables; `/reload` to apply) |
| Start flag | `pi --permission-mode <name>` |
| Load in dev | `pi -e ./extensions/permission-modes/index.ts` |
| Hot-reload | `/reload` (after edits) |
| Verify loaded | `pi list` |

### Standalone (npm scripts)

| Action | Command |
|---|---|
| Run tests | `npm test` |
| Watch tests | `npm run test:watch` |
| Dry-run package | `npm run pack:dry` |
| Publish | `npm publish` |

## Conventions
- **Style:** TypeScript, ESM (`import`/`export`), no semicolons (standard pi extension style)
- **Naming:** `camelCase` for variables/functions, `PascalCase` for types, `SCREAMING_SNAKE` for constants
- **Extension pattern:** Default-export a function receiving `pi: ExtensionAPI`, register hooks on `pi.on(...)` events
- **State management:** Plain module-scoped variables; persist via `pi.appendEntry("modes", ...)` with restore in `session_start` / `session_tree`
- **UI:** Use `ctx.hasUI` gating — never assume a UI exists
- **Types:** Use `type` from the pi-core packages; no external type deps

## Boundaries (technical)
- **Do NOT** add third-party runtime dependencies — peer deps only (pi-core + typebox)
- **Do NOT** change pi's core behavior — only intercept tool calls via `pi.on("tool_call", ...)` and return `{ block: true, reason }` or `undefined`
- **Do NOT** call `pi.setModel()` / `pi.setThinkingLevel()` on mode switches — the model-profile system was removed in v3.0.0; model & thinking level are the user's territory (pi's `/model`, this extension's `alt+t` cycle). A leftover `~/.pi/agent/model-profiles.json` is ignored.
- **Classifier** uses `@earendil-works/pi-ai/compat` `completeSimple` with credentials from `ctx.modelRegistry.getApiKeyAndHeaders()` — do not reimplement provider HTTP adapters
- **Do NOT** block bypass-mode writes outside cwd — bypass auto-approves and tracks snapshots for undo
- **Do NOT** filter skills via skill discovery or resource events — `filterSkillsFromPrompt()` in `utils.ts` is the approved mechanism (currently unused; per-mode skill filtering was removed with profiles in v3.0.0 and would need a new config home in `~/.pi/agent/permission-modes.json` if revived)
- **Do NOT** inject per-turn `modes-context` messages — mode hints go in the `<!-- permission-modes:context -->` system prompt anchor via `injectModePrompt()`
- **Do NOT** ship partial tool filtering — configurable per-mode tool filtering (wired into `tool_call`) is planned for a future release; its old config home (`model-profiles.json` ModeConfig.tools) was removed in v3.0.0, so the new implementation must define its own config in `~/.pi/agent/permission-modes.json`.
- **Do NOT** duplicate content between AGENTS.md and CLAUDE.md — keep AGENTS.md as the single source of truth
- **Safe to delete:** `.pi/permission-modes-45ea0551.md` (recreated automatically)
- **Invariants:** The four-mode cycle (ask → plan → auto → bypass) is hard-coded in `MODE_CYCLE`. Configured permission rules evaluate **before** mode gate (bypass exempt): deny → ask → allow. Auto uses tiered gating + optional classifier + `AUTO_RISK_PATTERNS` blacklist. Plan mode only allows writes to `plan.md`. Classifier + global permissions path: `~/.pi/agent/permission-modes.json`. Project permissions: `<cwd>/.pi/projects/<id>/permissions.json` (+ `permissions.local.json`). Mode switches never touch model/thinking (v3.0.0). Shortcut keys resolve via `resolveShortcuts()` once at factory load (defaults `shift+tab` / `alt+t`; `null` disables; keys lowercased) — pi's built-in `app.thinking.cycle` reserves `shift+tab` against extensions unless the user disables/rebinds it in `~/.pi/agent/keybindings.json`.

## Known Issues & Gotchas
- **Test infrastructure exists** — 298 tests across `index.test.ts`, `utils.test.ts`, `classifier-client.test.ts`, and permission rule modules. Always run `npm test` before committing non-trivial changes.
- **Unsafe shortcut keys** — `isUnsafeShortcutKey()` (config.ts) refuses keys that collide with terminal control characters (`ctrl+m` = Enter/CR, `ctrl+i` = Tab, `ctrl+j`, `ctrl+h` = Backspace, `ctrl+[` = Escape) or bare editor/typing keys (`tab`, `backspace`, `space`, bare or `shift+` single printable chars): pi matches `\r` for `ctrl+letter` unconditionally and dispatches extension shortcuts first, so registering e.g. `ctrl+m` hijacks Enter and bricks message submit. Never bypass this guard in `registerConfiguredShortcut()`.
- **Snapshot cap at 100:** Long-running sessions in bypass mode that touch >100 outside-cwd paths will LRU-evict oldest snapshots.
- The `--permission-mode` flag uses a distinct name because pi has a built-in `--mode` flag for output format (text/json/rpc). Do not rename it to `--mode`.
- Auto mode **does not** send per-turn Continue follow-ups (removed in v2.0.0).
- `typebox` is listed as a peer dep but not currently imported. It may be needed for future input validation.
- No `.env` / `.env.example` — this extension has no environment secrets.
- No `tsconfig.json` — pi bundles its own TypeScript configuration.
- **Registry indexing lag:** `npm view` can return stale data for a few minutes after publish. Verify via direct GET to `https://registry.npmjs.org/@georgedong32/permission-modes/<version>`.
- **Git tags:** Releases are tagged `v<version>` (e.g. `v1.1.6`). Tag and push with `git tag v<version> && git push origin v<version>`.

## Companion Extensions
- **minion (@aprimediet/minion):** Active (project `permission-modes-45ea0551`, 0 open tasks). Check the kanban board at `~/.pi/projects/permission-modes-45ea0551/tasks/` before starting work to see if any delegated tasks are pending.
- **memory (@aprimediet/memory):** Active (8+ entries). Durable facts are stored at `~/.pi/projects/permission-modes-45ea0551/memory/`. Use `memory_write` to save decisions/gotchas and `memory_search` to recall context.

## Current Focus
- **v3.0.0** — model-profile system removed; mode switches never touch model/thinking; configurable shortcuts (`cycleMode` / `cycleThinking`)
- **Next** — tool filtering (needs a new config home in `~/.pi/agent/permission-modes.json` — profiles were its old home), `/permissions add|remove` selectors
- See [CHANGELOG.md](CHANGELOG.md) for full release history
