# TODO

> 待办事项清单。勾选格式：`- [ ]` 未完成 / `- [x]` 已完成。
> 每项任务如有实现计划，在子项中以链接形式引入 `docs/plan/` 下的计划文档。
> 各段落内条目按计划时间从先到后排列。

## 进行中

- [ ] [Feature] 所有权限门禁的选项列表末尾追加「No, and tell the agent what to do differently」（UI 沿用原有选择器，仅加选项）
  - 实现计划：[docs/plan/20261030-0401-permission-feedback-dialog.md](plan/20261030-0401-permission-feedback-dialog.md)
  - 分支：`feat/permission-feedback-dialog`（自 `feat/configurable-shortcuts` 切出）
  - 状态：🚧 编码完成（新增 `permission-feedback.ts` + 单测 11 例；三处门禁集成测试 14 例；转发协议零改动；产物已重建 84,324 B / 29,352 B gzip，待实机验收与提交）

- [ ] [Fix] 权限选择器首尾循环导航（首项 ↑ 回末项 / 末项 ↓ 回首项；改用 `SelectList` 自绘选择器，计划批准对话框同步循环）
  - 实现计划：[docs/plan/20261107-0330-wrap-around-selector.md](plan/20261107-0330-wrap-around-selector.md)
  - 分支：`fix/wrap-around-selector`（自 `feat/permission-feedback-dialog` 最新提交 `381cc67` 切出）
  - 状态：🚧 编码完成（新增 `permission-selector.ts` + 15 例单测；5 处门禁迁移到 custom 选择器入口并补回绕集成用例；352 个测试全绿；产物已重建 86,807 B / 30,154 B gzip，待实机验收与提交）

## 已完成

- [x] [Feature] 支持自定义快捷键（`shortcuts` 配置段；默认保持 `shift+tab` / `alt+t` / `alt+i` 不变）
  - 实现计划：[docs/plan/20260829-2239-configurable-shortcuts.md](plan/20260829-2239-configurable-shortcuts.md)
  - 分支：`feat/configurable-shortcuts`（已提交，未推送远程，待用户推到 fork）
  - 状态：✅ 编码实现完成，新增 12 个测试全部通过（Windows 基线上既有的 24 个失败与本次改动无关，已用基线对照确认）

- [x] [Refactor] 彻底移除 model-profile 功能（切权限模式不再切换模型与思考强度；v3.0.0）
  - 实现计划：[docs/plan/20261007-1840-remove-model-profiles.md](plan/20261007-1840-remove-model-profiles.md)
  - 分支：`feat/remove-model-profiles`（自 `feat/configurable-shortcuts` 最新提交 `d038ffc` 切出）
  - 状态：✅ 编码实现完成，298 个测试全部通过（含修复一个在 pi 会话内跑套件时暴露的 mode-inherit 测试隔离问题）；待推送远程（fork + origin）

- [x] [Build] 插件代码打包压缩：pi 改为加载单文件 `dist/index.js`（零转译，22 个 TS → 1 个 bundle）
  - 实现计划：[docs/plan/20261007-2115-dist-bundle.md](plan/20261007-2115-dist-bundle.md)
  - 分支：`feat/dist-bundle`（自 `feat/remove-model-profiles` 最新提交 `ce4cd4d` 切出）
  - 状态：✅ 编码完成，307 个测试全部通过（新增 `dist.test.ts` 9 项产物守卫）；产物 83,197 B / gzip 28,994 B，三道构建门禁全过；待提交推送
