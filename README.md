# @georgedong32/permission-modes

[![npm version](https://img.shields.io/npm/v/@georgedong32/permission-modes)](https://www.npmjs.com/package/@georgedong32/permission-modes)
[![License](https://img.shields.io/npm/l/@georgedong32/permission-modes)](LICENSE)

Claude-Code-style **permission modes** for the [pi coding agent](https://www.npmjs.com/package/@earendil-works/pi-coding-agent). Five modes, cycled with **Shift+Tab**, that control how tool calls get approved. v2.0.0 adds **bypass**, a built-in **auto classifier**, **plan.md** file driver, and system-prompt anchor injection; the latest addition is **Read Only** for pure analysis/consulting. An optional reverse-cycle shortcut can be configured (see [Reverse cycling](#reverse-cycling)).

## Modes

| Mode | edit / write | reads outside cwd | bash | notes |
|---|---|---|---|---|
| **ask** `●` | prompt (`Allow` / `Allow all → bypass` / `Block`) | prompt | mutating commands prompt | one-line reminder on mode switch |
| **readonly** `◐` | removed from the tool set + blocked | allowed | read-only allowlist | no plan file, no plan dialog; plugin tools denied unless allowlisted |
| **plan** `⏸` | only `plan.md` | allowed | read-only allowlist | plan file at `.pi/projects/<id>/plan.md` |
| **auto** `▶` | cwd writes auto; risky ops → classifier/blacklist | auto | tiered | optional classifier in `permission-modes.json` |
| **bypass** `⚡` | all auto-approved (tracked outside cwd) | auto | auto | security reminder on switch + compact |

**Cycle (Shift+Tab):** ask → readonly → plan → auto → bypass → ask.

An **optional reverse shortcut** (`shortcuts.cycleModeReverse`, off unless you configure it) walks the same ring backwards — one press goes from `readonly` back to `ask` instead of four presses forward. See [Reverse cycling](#reverse-cycling).

The table and the cycle are ordered by **unattended autonomy**, not by permission strictness: `ask` stops for approval on every write, while `readonly` runs a whole turn without interruption (longer turns, more tokens, no human in the loop). In terms of *permission*, `readonly` is the smallest of the five — it is a hard ceiling that `allow` rules cannot widen — which is why it sits right after `ask` rather than at the end.

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

The interactive session writes `PERMISSION_MODES_INHERITED_MODE` (`readonly` | `ask` | `plan` | `auto` | `bypass`) into the process environment whenever the mode changes (and again on each `before_agent_start`). pi-subagents merges `process.env` into child spawns (and passes `--permission-mode` when that env is set), so headless children start in the **same mode** as the parent (e.g. parent bypass → child auto-approves; parent readonly → child cannot write either).

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

### Navigating permission prompts

Every permission list — the ask-mode approvals, the auto-mode tier-3 prompt, subagent approvals, `/mode`, `/undo-outside-writes`, and the plan-ready dialog — uses **wrap-around** navigation: <kbd>↑</kbd> on the first item jumps to the last, <kbd>↓</kbd> on the last jumps back to the first. <kbd>j</kbd> / <kbd>k</kbd> work as <kbd>↓</kbd> / <kbd>↑</kbd> aliases, <kbd>Enter</kbd> confirms, and <kbd>Esc</kbd> / <kbd>Ctrl+C</kbd> cancels. Long option lists scroll inside the terminal instead of overflowing it.

### Telling the agent what to do differently

Every permission prompt ends with one extra option:

```
No, and tell the agent what to do differently
```

Pick it and pi opens its native inline editor (`Tell the agent how to proceed with <tool>:`) — type what the agent should do instead and press <kbd>Enter</kbd>. The call is **blocked**, and your text rides along with the rejection reason, so the model sees both the denial and the correction:

```
bash blocked by user. User feedback: use the local VERSION file instead
```

- Works on the ask-mode approvals (bash / outside-cwd reads / edit-write), the auto-mode tier-3 prompt, and the subagent approval the parent session answers on a child's behalf.
- For a subagent request the option names the subagent (`No, and tell scout what to do differently`).
- Empty input, cancelling the editor, or cancelling the prompt = a plain block (nothing is ever let through).
- The feedback is **not** sent as a separate user message — it only travels with the denial reason.

## Model & thinking

**Switching permission modes never touches the model or the thinking level** — use pi's built-in `/model` and the `alt+t` shortcut instead. The model-profile system (`~/.pi/agent/model-profiles.json`, `/model-profile`, `Alt+I`, `--model-profile`) was removed in v3.0.0: it duplicated pi's native model switching and silently changed the model/effort on mode switches.

## Commands, shortcut, flag

| Kind | Name | Behavior |
|---|---|---|
| Command | `/readonly`, `/ask`, `/plan`, `/auto`, `/bypass` | switch to that mode (`/default` also works as alias) |
| Command | `/mode [name]` | set the given mode, or pick from a list |
| Command | `/auto-depth <n>` | cap auto-mode follow-ups (`0` = unlimited; default 20) |
| Shortcut | `Shift+Tab` | cycle modes (default — configurable, see below) |
| Shortcut | `Alt+T` | cycle thinking level (off → minimal → low → medium → high → xhigh) |
| Command | `/permissions` | list merged allow/deny/ask rules |
| Command | `/mode-hotkeys` | list this extension's shortcuts (forward/reverse mode cycle, thinking cycle) and whether each one is actually registered |
| Command | `/outside-writes` | list tracked outside-cwd writes (read-only) |
| Command | `/undo-outside-writes` | restore outside-cwd writes (selector, `all`, or `--list`) |
| Flag | `--permission-mode <name>` | start in a mode (accepts `readonly`, `ask`, `plan`, `auto`, `bypass`, or `default` as alias; default `ask`) |

> The start-mode flag is `--permission-mode` (not `--mode`) because pi already has a built-in `--mode` for output format (text/json/rpc).

### Custom shortcuts

All three shortcuts are configurable via the `shortcuts` block in `~/.pi/agent/permission-modes.json`:

```json
{
  "shortcuts": {
    "cycleMode": "alt+x",
    "cycleModeReverse": "alt+shift+x",
    "cycleThinking": "alt+t"
  }
}
```

- **Defaults**: `cycleMode: "shift+tab"`, `cycleThinking: "alt+t"`, and `cycleModeReverse: null` — the reverse cycle is **opt-in**: no key is registered until you set one, and nothing is warned about while it is unset. Leave it out and the plugin behaves exactly like 3.1.0.
- Keys are normalized to lowercase before registering; set a key to `null` (or an empty string) to disable that shortcut.
- **Unsafe keys are refused** (not registered) with a warning on stderr and at session start: terminal control-char aliases `ctrl+m` (= Enter/CR), `ctrl+i` (= Tab), `ctrl+j`, `ctrl+h` (= Backspace), `ctrl+[` (= Escape), the bare editor keys `tab` / `backspace` / `space`, and bare or `shift+`-prefixed single printable characters (they would shadow typing). Use a safe combo such as `ctrl+shift+m` or `alt+m` instead.
- The footer hint follows the registered `cycleMode` key only (omitted when disabled or refused). The optional reverse key is deliberately **not** shown there — run `/mode-hotkeys` to see every key and its real status (`active`, `not configured (optional)`, `disabled`, `refused (unsafe key)`, `not registered (same as cycleMode)`).
- A `cycleModeReverse` value that duplicates another registered key is **not** registered (with a warning) instead of silently overwriting it.
- Run `/reload` after editing the file for changes to take effect.

### Reverse cycling

- **Backwards walk:** bypass → auto → plan → readonly → ask, so `ask → readonly` (one forward press) can be undone with one reverse press. Pressing forward again undoes an overshoot, in either direction.
- **Symmetric wrap:** both directions wrap around the ring — forward `bypass → ask`, reverse `ask → bypass`. There is no direction-specific edge rule: bypass is equally reachable via `/mode` or repeated forward presses, so the guardrails are the bypass security reminder and the always-visible footer, not a reverse-only clamp.
- Reverse uses the same switch path as forward: identical persistence, tool-set changes, plan-file handling, subagent mode inheritance and reminders — and it **never** touches the model or thinking level.
- **Terminal caveat:** pi only receives `ctrl+shift+<letter>`, `alt+shift+<letter>`, `ctrl+tab` and `ctrl+shift+tab`-style combos from terminals that support the Kitty keyboard protocol or xterm `modifyOtherKeys`. Single-modifier `alt+<letter>` / `ctrl+<letter>` have a legacy encoding and work everywhere. `/mode-hotkeys` proves the extension registered the key — it cannot prove your terminal delivers it. If a key does nothing, try a legacy-safe combo such as `alt+r`.

> **Note — `shift+tab` conflict with pi's built-in binding.** pi binds `app.thinking.cycle` (cycle thinking level) to `shift+tab` by default and reserves it against extensions, so the default `cycleMode` key is silently dropped on stock pi. Either remap `cycleMode` to a free key as above, or free the key by adding `{"app.thinking.cycle": []}` to `~/.pi/agent/keybindings.json` (thinking-level cycling remains available on this extension's `alt+t`).

### Outside-cwd write tracking (v1.1.3)

In **auto mode**, `edit` and `write` calls to paths outside the working directory are auto-approved — but each one is snapshotted to `<cwd>/.pi/projects/<project-id>/tmp/outside-writes/`. Use `/undo-outside-writes` to roll back:

- `/undo-outside-writes` — interactive selector (newest first)
- `/undo-outside-writes all` — restore all without prompting
- `/undo-outside-writes --list` — list only (alias for `/outside-writes`)
- `/outside-writes` — same as `--list`

Snapshots capture the file's pre-write content (or `null` if the file didn't exist). They persist across sessions until you undo them. The snapshot cap is 100 entries (oldest are evicted; you get a notification).

### Read Only mode

`/readonly` (or `--permission-mode readonly`) is for **analysis and consulting**: the agent inspects the repo and answers in the conversation, without producing code or a plan.

- **No writes.** `edit` and `write` are removed from the active tool set *and* blocked at the gate. `bash` is limited to the read-only allowlist; `powershell` is not available.
- **No plan side effects.** It never creates/reads `plan.md`, never opens the plan-approval dialog, never extracts steps or tracks `[DONE:n]`, and never switches modes on its own. The injected prompt is short and static: answer in chat, don't produce an implementation plan unless asked, don't close by offering to implement.
- **Reads are never interrupted.** `read` / `grep` / `find` / `ls` are allowed, including outside the working directory — same as plan mode.
- **Read Only is a hard ceiling.** Configured `allow` rules cannot widen it (the gate runs before rule evaluation); `deny` rules still apply.
- **Other tools are denied by default.** Only plugins you explicitly allow are exempt:

```json
{
  "readonly": {
    "allowPlugins": ["pi-web-access"]
  }
}
```

Entries are matched **exactly** (case-insensitive) against the plugin's source — `pi-web-access`, `npm:pi-web-access`, and `git:…@ref` forms all normalize, and a short entry such as `pi` will **not** match `pi-web-access`. Allowlisting exempts every tool that plugin registers (so `web_enable` / `web_search` / `fetch_content` work and survive the per-turn tool-set cleanup). Leave the list empty to deny every non-builtin tool.

**Boundary — this is not a sandbox.** pi has no built-in sandbox, so Read Only is enforced at the tool-call and tool-set layers only. It is a guard against *accidental* edits, not against malicious code: an allowlisted plugin's own write tools are not inspected, and Read Only means "does not modify your project files" — network tools may still cache under `~/.pi/agent/` or `/tmp`.

### Plan mode flow

In plan mode the agent explores read-only and emits a numbered list under a `Plan:` header. On completion you choose:

- **Execute the plan** — switches to auto, restores edit/write, runs the steps; a `☐/☑` widget advances as the agent emits `[DONE:n]` tags, and you get **Plan Complete! ✓** at the end.
- **Stay in plan mode** — keep iterating.
- **Refine the plan** — opens an editor; your notes are sent back as a follow-up.

## UI

- A custom **adaptive footer** (v1.1.6): wide terminals show **cwd [git-branch] · context usage · model** on line 1 and **mode** on line 2; narrow terminals reflow to two compact lines with truncation.
- **Context usage** in the footer shows `tokens/contextWindow percent` (e.g. `42k/200k 21.0%`; large counts use `M`).
- While the agent is streaming, the working indicator shows live **token / tok-s / cost / % context** stats; it reverts to the default loader when idle.
- Mode colors: readonly = success, ask = muted, plan = accent, auto = warning. The colored status pill was removed in v1.1.6 — mode is shown in the footer only.

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
├── readonly-plugins.ts       # Read Only: plugin allowlist matching + tool classification
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
        ├── readonly-mode-prompts.md
        ├── ask-mode-prompts.md
        ├── plan-mode-prompts.md
        └── auto-mode-prompts.md
```

Runtime third-party deps: **none** — the shipped `dist/index.js` is a single self-contained file (89 kB / 31 kB gzip) that only imports `node:*` builtins and the pi host packages, which pi provides as virtual modules (peer dependencies: `@earendil-works/pi-coding-agent`, `@earendil-works/pi-ai`, `@earendil-works/pi-tui`, `typebox`). Build tooling (esbuild, vitest) is dev-only and pinned by the committed lockfile. **Switching permission modes never calls `setModel` / `setThinkingLevel`** — the extension only gates tool-call approvals.
