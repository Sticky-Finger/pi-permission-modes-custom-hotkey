# Ask Mode — Prompt Reference

> **Part of the v2.0.0 implementation.** Default permission mode (replaces v1.0.0's "default" mode).
> Corresponding `index.ts` constants: `MODE_CONTEXT["ask"]`, `MODE_META["ask"]`, `tool_call` gate case `"ask"`.

---

## 1. Mode metadata

```typescript
// MODE_META["ask"]
{ icon: "●", label: "Ask", role: "muted" }
```

- **Slash commands:** `/ask` (primary), `/default` (alias for backward compat)
- **Cycle position:** `ask → plan → auto → ask`
- **Flag:** `--permission-mode ask` (also accepts `--permission-mode default` with deprecation warning)

---

## 2. System context injection (`MODE_CONTEXT["ask"]`)

Injected into the agent's context window at the start of every turn via `before_agent_start`. Displayed to the model (not the user).

```
[ASK MODE ACTIVE]
Standard mode. File edits/writes and access outside the working directory
require explicit user approval before they run. Read-only operations inside
the working directory are auto-approved.
```

**Implementation:** `pi.on("before_agent_start", ...)` returns `{ message: { customType: "modes-context", content: [above], display: false } }`. Deduplication via `context` handler keeps only the latest instance.

---

## 3. UI confirmation prompts

All prompts use `ctx.ui.select(title, options)` when `ctx.hasUI` is true.

**No-UI behavior (fail-closed, never silently allowed):**

| Condition | Action |
|---|---|
| `!ctx.hasUI` and no `PI_SUBAGENT_PARENT_SESSION` | Block with `needs approval: no UI available` |
| `!ctx.hasUI` and `PI_SUBAGENT_PARENT_SESSION` set | Forward ask to parent session UI via `permission-modes-forwarding` inbox; parent Allow / Allow always / Block / feedback; timeout or deny → block |

Local ask-mode `edit`/`write` with UI still offers the six-option dialog (including bypass). Forwarded asks use the shared five-option set only (no bypass).

### 3.0 Shared approval option set

Every permission prompt ends with the same **last** option:

```
No, and tell the agent what to do differently
```

| Field | Value |
|---|---|
| **Label** | `No, and tell the agent what to do differently` (subagent prompts substitute the subagent name: `No, and tell scout what to do differently`) |
| **Position** | Always the **last** entry of the option list |
| **Follow-up prompt** | pi's native inline editor, titled `Tell the agent how to proceed with <tool>:` |
| **Effect** | The call is **blocked**; the block reason carries the typed text (see below) |

**Denial reason format:**

```
<tool> blocked by user[ on <path>]. User feedback: <sanitized text>
```

- The feedback text is whitespace-collapsed, trimmed, and capped at 1000 characters.
- Empty input, a cancelled editor, or a cancelled selector → **ordinary denial** (no `User feedback:` suffix, nothing is allowed through).
- The reason is what the model sees as the tool error, so the model receives both the rejection *and* the requested change.

### 3a. edit/write approval

| Field | Value |
|---|---|
| **Trigger** | `tool === "edit"` **or** `tool === "write"` |
| **Path check** | Any path (no outside-cwd distinction for writes — always prompt) |
| **Title** | `` `Allow ${tool} on ${path}?` `` |
| **Options** | `["Allow", "Allow always (this project)", "Allow always (global)", "Allow all (enable bypass)", "Block", <feedback option>]` |
| **Default** | (none — user must pick) |

**Behavior per option:**

| Choice | Action |
|---|---|
| `"Allow"` | Return `undefined` (allow the tool call) |
| `"Allow always (this project)"` | Persist a project-local allow rule + return `undefined` |
| `"Allow always (global)"` | Persist a global allow rule + return `undefined` |
| `"Allow all (enable bypass)"` | Call `setMode("bypass", ctx)` + return `undefined` |
| `"Block"` | Return `{ block: true, reason: \`${tool} blocked by user on ${path}\` }` |
| feedback option | Return `{ block: true, reason: \`${tool} blocked by user on ${path}. User feedback: <text>\` }` |

**No-UI fallback:** without parent session → `{ block: true, reason: \`${tool} blocked: no UI available to confirm.\` }` (via `promptApproval` / forwarding path: `needs approval: no UI available` or parent timeout/deny). With `PI_SUBAGENT_PARENT_SESSION`, forward to parent (five options; no bypass).

### 3b. read-outside-cwd approval (NEW in v1.1.0)

| Field | Value |
|---|---|
| **Trigger** | `tool === "read"` **AND** `isOutsideCwd(path, ctx.cwd) === true` |
| **Title** | `` `Allow ${tool}? outside cwd on "${path}"` `` |
| **Options** | `["Allow", "Allow always (this project)", "Allow always (global)", "Block", <feedback option>]` |

**Behavior:**

| Condition | Action |
|---|---|
| Inside cwd (`isOutsideCwd === false`) | Auto-approve (return `undefined`) |
| Outside cwd, user picks `"Allow"` | Return `undefined` |
| Outside cwd, user picks `"Block"` | Return `{ block: true, reason: \`${tool} blocked by user\` }` |
| Outside cwd, user picks the feedback option | Return `{ block: true, reason: \`${tool} blocked by user. User feedback: <text>\` }` |
| No UI | `{ block: true, reason: \`${tool} blocked: no UI available to confirm.\` }` |

### 3c. destructive bash approval

Same as v1.0.0 — carried forward unchanged, plus the shared feedback option.

| Field | Value |
|---|---|
| **Trigger** | `tool === "bash"` **AND** `isSafeCommand(cmd) === false` |
| **Title** | `` `Allow bash? "${cmd}"` `` |
| **Options** | `["Allow", "Allow always (this project)", "Allow always (global)", "Block", <feedback option>]` |

| Condition | Action |
|---|---|
| Safe command | Auto-approve (return `undefined`) |
| Unsafe, user picks `"Allow"` | Return `undefined` |
| Unsafe, user picks `"Block"` | Return `{ block: true, reason: \`bash blocked by user\` }` |
| Unsafe, user picks the feedback option | Return `{ block: true, reason: \`bash blocked by user. User feedback: <text>\` }` |
| No UI | `{ block: true, reason: \`bash blocked: no UI available to confirm.\` }` |

---

## 4. Decision tree (tool_call gate pseudocode)

```
if currentMode === "ask":
  if tool === "edit" || tool === "write":
    prompt 3a (edit/write approval)
  elif tool === "read":
    if isOutsideCwd(path, ctx.cwd):
      prompt 3b (read-outside-cwd approval)
    else:
      auto-approve
  elif tool === "bash":
    if isSafeCommand(cmd):
      auto-approve
    else:
      prompt 3c (destructive bash approval)
  else:
    auto-approve (other tools)
```

---

## 5. Related code locations

| What | File | Line area |
|---|---|---|
| `MODE_CONTEXT["ask"]` | `index.ts` | In the `MODE_CONTEXT` record definition |
| `MODE_META["ask"]` | `index.ts` | In the `MODE_META` record definition |
| edit/write prompt | `index.ts` | `tool_call` handler — `currentMode === "ask"` branch |
| read-outside-cwd prompt | `index.ts` | `tool_call` handler — `currentMode === "ask"` branch (NEW) |
| `isOutsideCwd()` | `utils.ts` | New helper for v1.1.0 |
