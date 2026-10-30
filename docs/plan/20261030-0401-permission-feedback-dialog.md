# 实现计划：所有权限门禁加入 CC 风格「No, and tell the agent what to do differently」内联输入选项

> 状态：**待审阅**（审阅通过后才会开始编码实现）
> 日期：2026-10-30
> 计划分支：`feat/permission-feedback-dialog`（自 `feat/configurable-shortcuts` 切出）

---

## 0. 一页看懂

**做什么**：把目前基于 `ctx.ui.select` 的权限审批弹窗替换为自定义对话框（`ctx.ui.custom`），在**每一个**权限门禁的最后新增一项「No, and tell the agent what to do differently」。用户用方向键移到该选项时，对话框内出现带边框的内联输入框（仿 Claude Code）；输入的文字作为 block reason 返回，模型据此收到用户指导。

| | 现在 | 改完后 |
|---|---|---|
| 审批 UI | `ui.select` 纯选项列表 | 自定义对话框：标题 + 命令详情 + 编号选项 + 内联反馈输入框 |
| 拒绝反馈 | 只有 Block，无文字 | 「No, and tell …」→ 用户文字并入 block reason |
| 覆盖门禁 | — | 3 处：ask 通用审批 / ask edit-write / 子代理转发审批 |
| RPC 模式 | `ui.select` 可用 | `custom()` 返回 `undefined` → 自动降级 `select` + `editor` 两步流 |

**目标样式**（用户 mockup）：

```
 Allow bash?
   cp /home/wpw/.claude/settings.json …
 Do you want to proceed?
 ❯ 1. Allow
   2. Allow always (this project)
   3. Allow always (global)
   4. Block
   ┌──────────────────────────────────────────────┐
   │ 5. No, and tell the agent what to do differently │
   │ > ▍在这里输入你的反馈，例如：不要读系统文件…    │
   └──────────────────────────────────────────────┘
 ↑↓ navigate · enter select · esc cancel
```

## 1. 背景（已核实）

- 三个权限门禁目前都用 `ctx.ui.select` 弹纯选项列表：
  1. `promptWithPermissionOptions()`（index.ts ~L215）：ask 模式 bash / cwd 外读取，**以及** auto 模式 tier-3 / 分类器回退 / 敏感路径 / soft-deny（4 选项）；
  2. ask 模式 edit/write（index.ts ~L1472）：5 选项（含 "Allow all (enable bypass)"）;
  3. `handleForwardedPermissionRequest()`（index.ts ~L1876）：父会话替子代理审批，结果（含 `denialReason`）经文件收件箱回传。
- 用户要求：不只 ask 模式，**所有**触发权限门禁的地方都要有 CC 风格的「否，并告诉 agent 换个做法」选项。

**已验证的关键 API 事实**：

- `ctx.ui.custom<T>(factory, {overlay, overlayOptions})` 提供带键盘焦点的完整自定义对话框；仓库先例：`plan-approval-dialog.ts`。
- pi-tui 导出 `Input`（单行输入组件：IME 光标标记、粘贴、撤销、kill-ring）。它**不处理** ↑/↓/Esc —— 由我们拦截这些键做列表导航，其余转发给它。
- RPC 模式的 `custom()` 返回 `undefined`（不支持），但 RPC 的 `select` + `editor` 经 JSON-RPC 可用 → 必须有回退路径。
- `ExtensionUIContext.input/editor(title, prefill)` 存在，可用于回退。

## 2. 目标

1. 三个门禁全部换用带内联反馈输入框的自定义对话框；
2. 反馈文字进入 block reason（转发门禁经 `denialReason` 回传子代理，转发协议零改动）；
3. RPC / 无 custom 支持时自动降级，功能不缺失、行为 fail-closed 不变；
4. 测试、构建门禁（`dist/index.js` 逐字节新鲜度、体积预算）、文档全部同步。

## 3. 代码改动

### 3.1 新建 `permission-dialog.ts`（与 plan-approval-dialog.ts 同级）

导出：

- `type PermissionDialogResult`：`allow` / `allow_always_local` / `allow_always_global` / `allow_all_bypass` / `block` / `block_feedback`（携带 feedback 字符串）/ `cancel`；
- 常量 `FEEDBACK_OPTION_LABEL = "No, and tell the agent what to do differently"`；
- 纯函数 `sanitizeFeedback(raw)`：压缩空白、trim、1000 字符截断；
- 纯函数 `buildPermissionOptionLabels({includeBypass?})`：Allow / Allow always (this project) / Allow always (global) / 可选 Allow all (enable bypass) / Block / 反馈项；
- `runPermissionDialog(ctx, {title, detailLines, includeBypass?, feedbackTarget?})`；
- 类 `PermissionDialogComponent`（导出供单测）。

### 3.2 `runPermissionDialog` 行为

- 经 `ctx.ui.custom` 渲染：居中 overlay，宽度约 76，`maxHeight: "60%"`；`feedbackTarget` 默认 `"the agent"`（转发门禁传子代理名字）。
- **回退**：`custom` 解析为 `undefined`（RPC 模式）或返回非对象 / 未知 `kind`（防御式；旧测试 mock 如 `"stay"` 也走这条路）→ 两步流：`ctx.ui.select(title, labels)`，选中反馈标签后 `ctx.ui.editor(...)`；editor 结果为空映射普通 `block`；取消映射 `cancel`。

### 3.3 `PermissionDialogComponent` 渲染与按键

- 渲染：顶部 `─` 分隔线、加粗标题、缩进暗色 detailLines（`truncateToWidth` 截断加省略号）、muted 的 "Do you want to proceed?"、编号选项（选中带 `❯`/accent）、选中反馈项时显示带边框内联输入框（`│ > <Input 行> │`，空值显示暗色占位符）、底部按键提示；`invalidate()` 渲染缓存仿 plan-approval-dialog；无鼠标处理。
- 按键（复用 `getKeybindings()` / `tui.select.*`）：
  - ↑/↓/k/j 导航（输入激活时也拦截）；
  - 数字键 1-9 跳转选择并立即激活（仅当不在反馈项上）；
  - 位于反馈项上：可打印字符 / 粘贴 / ←/→ / 退格直接进入内嵌 `Input`（`focused = true` → CURSOR_MARKER 定位硬件光标，支持 IME）；Enter 经 Input `onSubmit` 提交 → `done({kind:"block_feedback"})`（空提交 → `{kind:"block"}`）；Esc 且已有文字 → 选择上移到 Block（保留文字）；否则 Esc / Ctrl+C → `done({kind:"cancel"})`。

### 3.4 改接三个门禁（index.ts）

- **门禁 1**（~L276）：`runPermissionDialog(ctx, {title: "Allow ${tool}?", detailLines: [label]})`。allow / allow_always_* 逻辑不变；block 保持现有 compliance 标志与 reason；`block_feedback` → 相同标志 + reason `"${tool} blocked by user with feedback: ${sanitizeFeedback(feedback)}"`；`cancel` 等同 block（fail-closed，同今天 undefined 选择）。
- **门禁 2**（~L1472）：`runPermissionDialog(ctx, {title: "Allow ${tool} on ${pathVal}?", detailLines: [pathVal], includeBypass: true})`。`allow_all_bypass` → `setMode("bypass", ctx)`；`block_feedback` → reason `"${tool} blocked by user on ${pathVal}. User feedback: ${sanitizeFeedback(feedback)}"`；其余照旧。
- **门禁 3**（~L1876）：`runPermissionDialog(ctx, {title, detailLines: [request.message], feedbackTarget: request.requesterAgentName?.trim() || "the subagent"})`。`block_feedback` → decision `"block"` + `denialReason "${request.tool} blocked by user with feedback: ${sanitizeFeedback(feedback)}"`（转发协议零改动，反馈骑现有 `denialReason` 字段回传）。子代理 / 无 UI 侧不变。

## 4. 验证

- 新建 `permission-dialog.test.ts`：
  - 纯函数：`sanitizeFeedback`（空白压缩、长度截断）、`buildPermissionOptionLabels`（顺序、bypass 插入、反馈项居末）；
  - 组件直测（桩 tui：terminal columns 80 / rows 24 / 空 write / 空 requestRender；透传 theme）：渲染出编号选项；移到反馈项显示输入框；输入后 Enter → `block_feedback`；空 Enter → `block`；有文字 Esc → 选择上移；数字键跳选。
- `index.test.ts`：现有门禁测试经回退路径继续通过（默认 custom mock 返回 `"stay"` 无效 → 走 select 回退）。新增用例： custom 返回 `block_feedback` → reason 含反馈； 回退 custom→undefined + select→FEEDBACK_OPTION_LABEL + editor→文字 → reason 含反馈； 回退 editor 空 → 普通 block reason； edit/write `block_feedback` reason 含路径； 转发父会话 `block_feedback` → 响应 `denialReason` 含反馈。
- `npm run build` 重建并提交 `dist/index.js`（`dist.test.ts` 逐字节新鲜度门禁）；当前包体 83 kB / 预算 90 kB，若超出按 `scripts/build.js` 规则小幅上调 `SIZE_BUDGET_BYTES` / `SIZE_BUDGET_GZIP_BYTES`（有记录的审慎决定）并在 CHANGELOG 注明。
- `npm test` 全绿后再提交。

## 5. 文档同步

- `README.md`：审批选项说明 + 子代理转发章节；
- `docs/prompts/ask-mode-prompts.md` §3：选项表 + 自定义对话框 + RPC 回退；
- `AGENTS.md`：不变式条目（所有门禁提供 Block-with-feedback）；
- `CHANGELOG.md`：[Unreleased] Added 条目。

## 6. 明确不做的事

- 弹窗内的多行编辑器（v1 单行 `Input`；回退路径已用多行 `ui.editor`）；
- 把反馈作为独立用户消息发送（仅经 tool-result 的 block reason 送达模型）；
- `/undo-outside-writes` 与 `/mode` 选择器（不是权限门禁）。

## 7. 风险与备注

- **体积预算**：新组件约使包体接近 90 kB 上限，超限则按规则上调预算并在 CHANGELOG 记录理由；
- **RPC 模式**：`custom()` 恒返回 `undefined`，靠回退保证功能完整；回退与自定义两条路径都要有测试；
- **IME**：内嵌 `Input` 置 `focused = true` 发出 CURSOR_MARKER，硬件光标随输入位置移动，中文输入法候选框定位正常；
- **既有测试兼容**：默认 custom mock 的 `"stay"` 被判定无效 → 自动走 select 回退，避免大面积改测试。
