# @georgedong32/permission-modes

[![npm version](https://img.shields.io/npm/v/@georgedong32/permission-modes)](https://www.npmjs.com/package/@georgedong32/permission-modes)
[![License](https://img.shields.io/npm/l/@georgedong32/permission-modes)](LICENSE)

Claude-Code-style **permission modes** for the [pi coding agent](https://www.npmjs.com/package/@earendil-works/pi-coding-agent). Four modes, cycled with **Shift+Tab**, that control how tool calls get approved. v2.0.0 adds **bypass**, a built-in **auto classifier**, **plan.md** file driver, and system-prompt anchor injection.

## Modes

| Mode | edit / write | reads outside cwd | bash | notes |
|---|---|---|---|---|
| **ask** `●` | prompt (`Allow` / `Allow all → bypass` / `Block`) | prompt | mutating commands prompt | one-line reminder on mode switch |
| **plan** `⏸` | only `plan.md` | allowed | read-only allowlist | plan file at `.pi/projects/<id>/plan.md` |
| **auto** `▶` | cwd writes auto; risky ops → classifier/blacklist | auto | tiered | optional classifier in `permission-modes.json` |
| **bypass** `⚡` | all auto-approved (tracked outside cwd) | auto | auto | security reminder on switch + compact |

**Cycle (Shift+Tab):** ask → plan → auto → bypass → ask.

When there is no interactive UI (`pi -p`, `--mode json`), anything that would prompt is **blocked** instead of silently allowed — unless the process is a **pi-subagents child** with `PI_SUBAGENT_PARENT_SESSION` set; then the ask is forwarded to the parent session UI (see below).

### Subagent permission forwarding

Headless subagent children cannot show `ctx.ui.select`. With **pi-subagents**, the root interactive session exports `PI_SUBAGENT_PARENT_SESSION`, and children inherit it (spawn also passes the direct parent session id).

When permission-modes would prompt and `!ctx.hasUI`:

1. If `PI_SUBAGENT_PARENT_SESSION` is unset → **fail-closed block** (same as before).
2. If set → write a request under  
   `~/.pi/agent/sessions/permission-modes-forwarding/sessions/<parentSessionId>/requests/`  
   and poll for a response (250ms interval, 10 minute timeout).
3. The parent session (has UI, not `PI_SUBAGENT_CHILD=1`) runs a poller that shows  
   Allow / Allow always (this project) / Allow always (global) / Block.  
   **Allow always** rules are written using the request’s **child `cwd`**, not the parent cwd.
4. Timeout, cancel, or Block → child gets a block reason (never silently allowed).

**Limits:** nested subagents whose direct parent has no UI still time out and deny (this package does not rewrite the target to the root session). This inbox path is **not** shared with `@gotgenes/pi-permission-system` (`permission-forwarding/`); the two can coexist without double-handling.

### Subagent inherits parent mode

The interactive session writes `PERMISSION_MODES_INHERITED_MODE` (`ask` | `plan` | `auto` | `bypass`) into the process environment whenever the mode changes (and again on each `before_agent_start`). pi-subagents merges `process.env` into child spawns (and passes `--permission-mode` when that env is set), so headless children start in the **same mode** as the parent (e.g. parent bypass → child auto-approves; no approval popups).

### Auto classifier (optional)

Configure `~/.pi/agent/permission-modes.json`:

```json
{
  "classifier": {
    "enabled": false,
    "model": "anthropic/claude-haiku-4-5",
    "timeoutMs": 8000
  }
}
```

Uses `completeSimple` from `@earendil-works/pi-ai/compat` with credentials from pi's `modelRegistry` — all built-in provider APIs (Anthropic, OpenAI, Azure, etc.) are supported automatically.

### Permission rules (v2.1.0, CC-compatible)

Configure **allow / deny / ask** rules in Claude Code syntax (`Tool` or `Tool(specifier)`). Rules merge across scopes; evaluation order is **deny → ask → allow** (deny cannot be overridden).

| Scope | Path |
|---|---|
| Global | `~/.pi/agent/permission-modes.json` → `permissions` block |
| Project (shareable) | `<cwd>/.pi/projects/<id>/permissions.json` |
| Project local | `<cwd>/.pi/projects/<id>/permissions.local.json` (personal; add to `.gitignore`) |

Example global config:

```json
{
  "classifier": { "enabled": false },
  "permissions": {
    "allow": ["Bash(npm run test *)", "Read(~/.zshrc)"],
    "deny": ["Bash(curl *)", "Read(./.env)", "Read(./.git/**)"],
    "ask": ["Bash(npm install *)"]
  }
}
```

When a tool call would prompt, you can choose **Allow always (this project)** or **Allow always (global)** to persist an allow rule. Use `/permissions` to list the merged rule set.

## Model & thinking

**Switching permission modes never touches the model or the thinking level** — use pi's built-in `/model` and the `alt+t` shortcut instead. The model-profile system (`~/.pi/agent/model-profiles.json`, `/model-profile`, `Alt+I`, `--model-profile`) was removed in v3.0.0: it duplicated pi's native model switching and silently changed the model/effort on mode switches.

## Commands, shortcut, flag

| Kind | Name | Behavior |
|---|---|---|
| Command | `/ask`, `/plan`, `/auto` | switch to that mode (`/default` also works as alias) |
| Command | `/mode [name]` | set the given mode, or pick from a list |
| Command | `/auto-depth <n>` | cap auto-mode follow-ups (`0` = unlimited; default 20) |
| Shortcut | `Shift+Tab` | cycle modes (default — configurable, see below) |
| Shortcut | `Alt+T` | cycle thinking level (off → minimal → low → medium → high → xhigh) |
| Command | `/permissions` | list merged allow/deny/ask rules |
| Command | `/outside-writes` | list tracked outside-cwd writes (read-only) |
| Command | `/undo-outside-writes` | restore outside-cwd writes (selector, `all`, or `--list`) |
| Flag | `--permission-mode <name>` | start in a mode (accepts `ask`, `plan`, `auto`, or `default` as alias; default `ask`) |

> The start-mode flag is `--permission-mode` (not `--mode`) because pi already has a built-in `--mode` for output format (text/json/rpc).

### Custom shortcuts

Both shortcuts are configurable via the `shortcuts` block in `~/.pi/agent/permission-modes.json`:

```json
{
  "shortcuts": {
    "cycleMode": "ctrl+shift+m",
    "cycleThinking": "alt+t"
  }
}
```

- **Defaults** (when the block or a key is omitted): `cycleMode: "shift+tab"`, `cycleThinking: "alt+t"` — behavior is unchanged from previous versions.
- Keys are normalized to lowercase before registering; set a key to `null` to disable that shortcut entirely.
- **Unsafe keys are refused** (not registered) with a warning on stderr and at session start: terminal control-char aliases `ctrl+m` (= Enter/CR), `ctrl+i` (= Tab), `ctrl+j`, `ctrl+h` (= Backspace), `ctrl+[` (= Escape), the bare editor keys `tab` / `backspace` / `space`, and bare or `shift+`-prefixed single printable characters (they would shadow typing). Use a safe combo such as `ctrl+shift+m` or `alt+m` instead.
- The footer hint follows the registered `cycleMode` key (omitted when disabled or refused).
- Run `/reload` after editing the file for changes to take effect.

> **Note — `shift+tab` conflict with pi's built-in binding.** pi binds `app.thinking.cycle` (cycle thinking level) to `shift+tab` by default and reserves it against extensions, so the default `cycleMode` key is silently dropped on stock pi. Either remap `cycleMode` to a free key as above, or free the key by adding `{"app.thinking.cycle": []}` to `~/.pi/agent/keybindings.json` (thinking-level cycling remains available on this extension's `alt+t`).

### Outside-cwd write tracking (v1.1.3)

In **auto mode**, `edit` and `write` calls to paths outside the working directory are auto-approved — but each one is snapshotted to `<cwd>/.pi/projects/<project-id>/tmp/outside-writes/`. Use `/undo-outside-writes` to roll back:

- `/undo-outside-writes` — interactive selector (newest first)
- `/undo-outside-writes all` — restore all without prompting
- `/undo-outside-writes --list` — list only (alias for `/outside-writes`)
- `/outside-writes` — same as `--list`

Snapshots capture the file's pre-write content (or `null` if the file didn't exist). They persist across sessions until you undo them. The snapshot cap is 100 entries (oldest are evicted; you get a notification).

### Plan mode flow

In plan mode the agent explores read-only and emits a numbered list under a `Plan:` header. On completion you choose:

- **Execute the plan** — switches to auto, restores edit/write, runs the steps; a `☐/☑` widget advances as the agent emits `[DONE:n]` tags, and you get **Plan Complete! ✓** at the end.
- **Stay in plan mode** — keep iterating.
- **Refine the plan** — opens an editor; your notes are sent back as a follow-up.

## UI

- A custom **adaptive footer** (v1.1.6): wide terminals show **cwd [git-branch] · context usage · model** on line 1 and **mode** on line 2; narrow terminals reflow to two compact lines with truncation.
- **Context usage** in the footer shows `tokens/contextWindow percent` (e.g. `42k/200k 21.0%`; large counts use `M`).
- While the agent is streaming, the working indicator shows live **token / tok-s / cost / % context** stats; it reverts to the default loader when idle.
- Mode colors: ask = muted, plan = accent, auto = warning. The colored status pill was removed in v1.1.6 — mode is shown in the footer only.

Current mode and the auto-follow-up depth **persist** across `/reload` and session resume.

## Install / run

```bash
# Install as a package (scoped npm name; or from a git remote / local path)
pi install npm:@georgedong32/permission-modes
pi list                                            # verify it loaded

# Or run it directly for a quick try (no install; loads the built bundle)
pi -e ./extensions/permission-modes/dist/index.js

# During development, hot-reload after edits
/reload
```

Auto-discovery also works: drop this folder at `~/.pi/agent/extensions/permission-modes/` (global) or `.pi/extensions/permission-modes/` (project) — pi reads `pi.extensions` from `package.json` and loads `dist/index.js`.

## Build

pi loads the prebuilt single-file bundle `dist/index.js` (zero runtime dependencies — every third-party import would be either inlined and registered, or rejected by the build gates). Source lives in the repo's TypeScript modules; rebuild after editing them and commit the result:

```bash
npm run build                # bundle + gates: import whitelist, inlined inventory, size budget
npm run build -- --no-minify # readable build for debugging (do not commit)
npm run build -- --report    # print the module inventory (what got bundled, sizes)
```

`dist.test.ts` fails when the committed bundle is stale, imports a non-host package, or exceeds the size budget.

## Testing

```bash
npm test                # run all tests (vitest), including the dist artifact guards
npm run test:watch      # watch mode for development
```

## Changelog

See [CHANGELOG.md](CHANGELOG.md) for the full release history.

## Layout

```
permission-modes/             # @georgedong32/permission-modes
├── package.json              # pi manifest (pi.extensions → dist/index.js) + npm metadata
├── package-lock.json         # dev dependency tree, committed (exact versions + integrity)
├── index.ts                  # main extension source (default-exported factory)
├── utils.ts                  # bash allowlist + Plan: + [DONE:n] helpers
├── scripts/build.js          # esbuild bundler + build gates (single-file dist)
├── dist/index.js             # COMMITTED build artifact — what pi actually loads
├── types/raw.d.ts            # editor types for `*.txt?raw` imports
├── *.test.ts                 # tests (vitest), incl. dist.test.ts artifact guards
├── vitest.config.ts          # vitest config
├── CHANGELOG.md              # release history
├── LICENSE                   # MIT
├── .gitignore                # excludes node_modules, .pi/ artifacts (lock is committed)
└── docs/
    ├── PRD.md                # product requirements
    └── prompts/              # mode-specific prompt context
        ├── ask-mode-prompts.md
        ├── plan-mode-prompts.md
        └── auto-mode-prompts.md
```

Runtime third-party deps: **none** — the shipped `dist/index.js` is a single self-contained file (83 kB / 29 kB gzip) that only imports `node:*` builtins and the pi host packages, which pi provides as virtual modules (peer dependencies: `@earendil-works/pi-coding-agent`, `@earendil-works/pi-ai`, `@earendil-works/pi-tui`, `typebox`). Build tooling (esbuild, vitest) is dev-only and pinned by the committed lockfile. **Switching permission modes never calls `setModel` / `setThinkingLevel`** — the extension only gates tool-call approvals.
