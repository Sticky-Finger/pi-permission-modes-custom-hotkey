# 权限选择器循环导航（首项 ↑ 回绕末项 / 末项 ↓ 回绕首项）

> 状态：**已批准**（2026-11-07 用户确认直接实现）
> 日期：2026-11-07
> 计划分支：`fix/wrap-around-selector`（自 `feat/permission-feedback-dialog` 切出）

## 0. 一页看懂

| 现状 | 改完后 |
| --- | --- |
| 权限确认列表选中第一项时按 ↑ 不动（停在首项） | 首项按 ↑ 跳到**最后一项** |
| 选中最后一项时按 ↓ 不动（停在末项） | 末项按 ↓ 跳到**第一项** |
| 计划批准对话框上下键同样夹取 | 同样改为循环 |

关键铁律：只改选择器的导航行为，**不改任何权限判定结果**（allow / allow always local / allow always global / block / feedback 的语义与副作用保持原样）。

## 1. 背景（已核实）

- 用户截图中的提示 `Allow bash? "…"` 及其 5 个选项来自本插件：第 5 项 `No, and tell the agent what to do differently` 是本插件（`permission-feedback` 特性）新增的选项。
- 该提示调用的是 pi 的 `ctx.ui.select()`，由 pi 内置的 `ExtensionSelectorComponent` 渲染；其上下键实现为**夹取**：
  - `up`：`Math.max(0, selectedIndex - 1)`
  - `down`：`Math.min(options.length - 1, selectedIndex + 1)`
  - 已在 pi 1.0.4 二进制内嵌源码与 `node_modules/@earendil-works/pi-coding-agent@0.84.4` 产物中确认。
- 对照：pi 内置 `/model` 等列表使用的 `SelectList`（`@earendil-works/pi-tui`）是**循环**的（首项 ↑ → 末项、末项 ↓ → 首项）。
- 结论：`ctx.ui.select()` 没有可开启循环的参数，插件只能自己接管选择器的渲染；本插件已有 `ctx.ui.custom()` 的先例（`plan-approval-dialog.ts`）。
- 本插件当前有 5 处 `ctx.ui.select`：ask 模式编辑/写入门禁、auto 模式人工确认门禁、子代理转发的权限请求、`/mode`、`/undo-outside-writes`。

## 2. 需求目标（验收标准）

1. **权限确认列表**（三处门禁：ask 编辑/写入、auto 人工确认、子代理转发）中：
   - 选中第一项按 ↑ 跳到最后一项；
   - 选中最后一项按 ↓ 跳到第一项；
   - 其余上下移动行为不变。
2. `Enter` 选中、`Esc`/`Ctrl+C` 取消、`j`/`k` 快捷键的行为与现状一致；取消返回「未选择」，调用方按原有「拒绝」分支处理。
3. 选项列表在终端高度不足时不超出可视区域（长列表可滚动），不因回绕而破坏渲染。
4. 插件内其余选择器（`/mode`、`/undo-outside-writes`）与计划批准对话框（`plan-approval-dialog.ts`，当前同样夹取）统一为循环导航。
5. 无 UI 环境（`!ctx.hasUI`、print / RPC 模式）保持现有回退行为，不新增异常路径。
6. 所有既有权限判定逻辑与副作用（写入 allow 规则、切换到 bypass、注入反馈、子代理决策回传）零行为变更。

## 3. 验证

- 单元/集成测试：
  - 新增回绕用例：首项 ↑ → 末项；末项 ↓ → 首项；
  - 既有门禁用例（allow / allow always local / allow always global / block / feedback / 子代理转发）全部保持通过；
  - 计划批准对话框补回绕断言。
- `npm test` 全绿。
- `npm run build` 重建 `dist/index.js` 并提交（`dist.test.ts` 的产物新鲜度门禁必须通过）。
- 实机验收：在 pi 会话中触发一次 bash 权限提示，首项按 ↑ 应跳到「No, and tell the agent what to do differently」，末项按 ↓ 应回到「Allow」；`Enter` / `Esc` 行为正常。

## 4. 文档同步

- `README.md`：说明权限选择器支持首尾循环导航。
- `CHANGELOG.md`：`[Unreleased] → Fixed` 记录本次修复。
- `docs/TODO.md`：新增本次需求条目并随进度更新状态。
- 本计划文档随实现一起保留在 `docs/plan/`。

## 5. 明确不做的事

- 不修改 pi 本体或二进制，也不 patch pi 的 `ExtensionSelectorComponent`。
- 不改动权限判定、规则持久化、分类器、子代理转发协议。
- 不引入第三方运行时依赖（选择器复用已有 peer 依赖 `@earendil-works/pi-tui`）。
- 不自动提交、不推送、不发版（按 `WORKFLOW.md` §7，需用户明确同意）。

## 6. 风险与备注

- **与原生选择器的差异**：自接管的选择器与 pi 原生 `ui.select` 在编辑器文本恢复、`timeout` / `signal` 选项上不完全等价；本插件目前未使用这些选项，若后续需要再补。
- **测试面**：现有测试通过伪造的 `select` 桩驱动门禁结果，改造后需迁移到新的选择器入口，约 15 处，需逐条确认语义不变。
- **版本漂移**：`SelectList` 的构造签名在 0.84.x 与 1.0.x 一致；若未来变化，可退化为插件自绘列表。
- **上游可选项**：可向 `earendil-works/pi` 提 issue（扩展选择器不循环、长列表无窗口化，参见上游 issue #6688），但不阻塞本次修复。
- **实现备注（2026-11-07）**：
  - 选择器在 `ctx.mode === "rpc"` 时回退到原生 `ctx.ui.select`（RPC 无 TUI，`ui.custom` 不可用），其余有 UI 的环境走自绘 `SelectList` 选择器；`!ctx.hasUI` 直接返回未选择，与现状一致。
  - `vitest.config.ts` 增加 `.agents/**` 排除：仓库内嵌套的 harness worktree 会被 `**/*.test.ts` 收集，其过期产物测试会让 `npm test` 误报；该改动仅影响测试发现，与选择器行为无关。
  - 原生选择器在提示中响应 `app.tools.expand`（ctrl+o 展开工具输出）与 `timeout` 倒计时；自绘选择器未接管这两项（本插件的权限提示此前也未使用 timeout，ctrl+o 在提示期间不再生效）。
