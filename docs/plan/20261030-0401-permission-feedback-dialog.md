# 实现计划：所有权限门禁加入「No, and tell the agent what to do differently」反馈选项（v3：最小改动，UI 沿用原有）

> 状态：**待审阅**（审阅通过后才会开始编码实现）
> 日期：2026-10-30（v3 修订：最小改动版，UI 沿用原有）
> 计划分支：`feat/permission-feedback-dialog`（自 `feat/configurable-shortcuts` 切出）
> 历史版本：v1 = 自绘浮层对话框（已实现并提交 `5e276a3`，**用户验收不通过并已删除**）；v2 = 回到内联选择器（未实施）；v3 = 本文档

---

## 0. 一页看懂

**做什么**：在现有权限审批的选项列表**末尾追加一项**「No, and tell the agent what to do differently」。用户选中它后，出现 pi 原生的输入框（内联在对话流末尾），用户输入的一句话会作为**拒绝原因**回传给模型，让模型知道该怎么做 differently。

**原则：审批界面一行不改。** 沿用改造前的呈现方式 —— 同样的标题、同样的选项顺序、同样的渲染位置、同样完整显示被审核的命令。**只多一个选项。**

| | 改造前 | 改动后 |
|---|---|---|
| 审批界面 | 内联在对话流末尾的选择器 | **完全相同** |
| 被审核的命令 | 标题里完整显示，换行不截断 | **完全相同** |
| 选项 | Allow / Allow always ×2 /（edit-write 才有 bypass）/ Block | 末尾追加 **「No, and tell the agent what to do differently」** |
| 反馈输入 | — | 选中该项后出现 pi 原生输入框（内联在对话流末尾） |

**期望效果**（对话流末尾）：

```
 Allow bash? "ls node_modules/@earendil-works/ 2>/dev/null; ls node_modules/@earendil-works/pi-tui 2>/dev/null"
 ↑↓ navigate · enter select · esc cancel
   Allow
   Allow always (this project)
   Allow always (global)
   Block
   No, and tell the agent what to do differently
```

选中最后一项 →

```
 Tell the agent how to proceed with bash:
 不要读系统文件，请读取项目内的 VERSION 文件
```

---

## 1. 背景（已核实）

- 现有三处审批门禁：
  1. 通用审批 —— ask 模式的 bash 与 cwd 外读取，以及 auto 模式的风险提问（tier-3 / 分类器回退 / 敏感路径 / soft-deny）；
  2. ask 模式的 edit / write；
  3. 子代理发起的审批 —— 由父会话代答，结果回传给子代理。
- 第一版把三处换成了自绘的浮层对话框，用户验收**不通过**并已删除该实现：浮层压在工具输出上、破坏对话流阅读；被审核的长命令还被 `…` 截断。
- 已核实的结论：pi 原生的选择器把标题按终端宽度**换行显示、不截断**，且整个组件内联在对话流末尾；pi 原生的输入框同样是内联的、Esc 可取消。**沿用原生 UI 就没有遮挡与截断问题。**
- 教训：**只加选项，不动 UI。**

---

## 2. 需求目标（验收标准）

1. **选项**：三处门禁的选项列表末尾都出现反馈项，文案 `No, and tell the agent what to do differently`；子代理场景用子代理名代替 agent（如 `No, and tell scout what to do differently`）。
2. **反馈输入**：选中该项后出现 pi 原生输入框，用户可输入一段文字（多行可，单行可）。
3. **反馈生效**：提交后当前调用**被拒绝**，且这段文字随拒绝原因一起回传给模型 —— 模型能看到「用户希望怎么做 differently」。
4. **取消与空输入**：输入为空、或用户取消输入、或直接取消整个审批 → 一律按**普通拒绝**处理（不放行）。
5. **界面零变化**：审批的标题、选项顺序、渲染位置、命令与路径的完整显示方式，全部与改造前一致；不遮挡对话内容，不出现省略号截断。
6. **其余选项行为不变**：未选反馈项时，Allow / Allow always / bypass / Block 的效果与改造前完全相同。
7. **子代理侧不变**：转发协议不改，反馈随既有的拒绝原因字段回传给子代理。

---

## 3. 验证

- 单元测试：反馈文本的清洗规则（多余空白合并、长度上限）。
- 集成测试（三个门禁各一）：选反馈项 + 输入文字 → 拒绝原因含该文字；输入为空 → 拒绝原因与改造前一致（不含反馈）；子代理场景 → 子代理收到的拒绝原因含该文字。
- `npm test` 全绿；`npm run build` 重建产物并通过体积与新鲜度门禁（本次为纯增量，包体变化极小）。
- **实机验收**：改动留在工作区，由用户在真实会话里试三种场景（bash、edit/write、越界读取），确认审批位置、命令完整显示、反馈能送达模型之后，再决定是否提交。

---

## 4. 文档同步

- `README.md` —— 审批选项说明追加反馈项；
- `docs/prompts/ask-mode-prompts.md` §3 —— 选项表与拒绝原因说明；
- `CHANGELOG.md` —— [Unreleased] 记录一条；
- `docs/TODO.md` —— 状态推进；
- 不动 `AGENTS.md` / `CLAUDE.md`（WORKFLOW §6：需用户明确要求）。

---

## 5. 明确不做的事

- 不改审批界面的任何呈现（标题、选项顺序、渲染位置、命令显示方式）；
- 不做浮层 / 自绘对话框 / 选项内嵌输入框；
- 反馈不作为独立用户消息发送，只随拒绝原因送达模型；
- 不动 `/mode`、`/undo-outside-writes` 等非审批场景的选择器。

---

## 6. 风险与备注

- **两步交互**：反馈需要「先选选项、再输入文字」两步；pi 的原生选择器不支持在列表里直接输入，沿用原生 UI 就必然如此。
- **取消语义**：输入框里取消 = 放弃反馈 = 普通拒绝（fail-closed，绝不静默放行）。
- **子代理协议不变**：反馈走既有拒绝原因字段，父会话与子代理之间不需要新协议。
- **包体**：纯增量，体积预算压力可忽略。

---

## 7. 实施结果

**已完成（2026-10-30）。**

### 实现

| 变更 | 位置 |
|---|---|
| 新增纯函数模块 `permission-feedback.ts` | 选项文案 / 反馈提示标题 / 反馈清洗（合并空白 + 1000 字符上限）/ 拒绝原因拼接 |
| 通用审批门禁（ask bash + cwd 外读取、auto tier-3） | `index.ts` → `promptWithPermissionOptions`：选项列表末尾追加反馈项 |
| ask 模式 edit/write 门禁 | `index.ts` → tool_call gate：同样末尾追加（保留原有 bypass 选项位置） |
| 子代理转发审批（父会话代答） | `index.ts` → `handleForwardedPermissionRequest`：反馈项文案带子代理名；反馈写入既有 `denialReason` 字段 |
| 子代理名传递 | `permission-forwarding.ts` → `deriveRequesterAgentName()`（从子会话名取 agent 段）；子进程转发时填入既有可选字段 `requesterAgentName`（**协议字段未新增**） |
| 反馈输入框 | 使用 pi 原生 `ctx.ui.editor()`（内联在对话流末尾，非自绘浮层） |

### 与计划的偏差

1. **子代理场景的反馈文案默认是「the subagent」而不是「the agent」**：计划 §2.1 举例为 `No, and tell scout what to do differently`，但当子代理名不可得时无法填入具体名字，故退化为 `No, and tell the subagent what to do differently`（子代理名可得时仍按计划显示名字）。
2. **子代理名来源与一处附带影响**：计划未指定来源。实现采用子进程会话名的 agent 段（pi-subagents 的子会话名为 `<agent>: <任务摘要>`），取不到时不填 `requesterAgentName`。
   - `requesterAgentName` 是**既有可选协议字段**（v2.6.3 起就在类型与父会话标题里），本次只是首次真正填值，**未新增任何协议字段**。
   - 附带影响：父会话的转发审批标题由 `[Subagent] Allow bash? ...` 变为 `[Subagent scout] Allow bash? ...`（父会话标题本来就写好了带名字的分支，只是此前永远为空）。若需保持旧标题，去掉子进程侧填充即可（反馈文案随之退化为「the subagent」）。
3. **反馈的提示标题**：`Tell the agent how to proceed with <tool>:`（计划示例与此一致）。

### 验证数据

- `npm test`：**334 个测试全部通过**（基线 307 + 新增 27）。
  - 新增 `permission-feedback.test.ts`：11 例（文案 / 标题 / 清洗 / 拒绝原因拼接）。
  - `index.test.ts` 新增：14 例（三处门禁的选项顺序、反馈入拒绝原因、空输入与取消退化为普通拒绝、其余选项行为不变、auto tier-3、子代理父会话侧反馈与子代理名、子进程转发把反馈带给子代理）。
  - `permission-forwarding.test.ts` 新增：2 例（`deriveRequesterAgentName` 提取与拒绝）。
- `npm run build`：产物 **84,324 B raw / 29,352 B gzip**（预算 92,160 B / 32,768 B），三道构建门禁全过；基线 83,197 B / 28,994 B，**增量 +1,127 B raw / +358 B gzip**（纯增量，远低于预算压力）。

### 待办

- 实机验收（bash / edit-write / 越界读取三种场景）后由用户确认是否提交（提交需用户本人明确同意）。
