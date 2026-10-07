# TODO

> 待办事项清单。勾选格式：`- [ ]` 未完成 / `- [x]` 已完成。
> 每项任务如有实现计划，在子项中以链接形式引入 `docs/plan/` 下的计划文档。

## 进行中

- [x] [Feature] 支持自定义快捷键（`shortcuts` 配置段；默认保持 `shift+tab` / `alt+t` / `alt+i` 不变）
  - 实现计划：[docs/plan/20260829-2239-configurable-shortcuts.md](plan/20260829-2239-configurable-shortcuts.md)
  - 分支：`feat/configurable-shortcuts`（已提交，未推送远程，待用户推到 fork）
  - 状态：✅ 编码实现完成，新增 12 个测试全部通过（Windows 基线上既有的 24 个失败与本次改动无关，已用基线对照确认）

- [ ] [Refactor] 彻底移除 model-profile 功能（切权限模式不再切换模型与思考强度；v3.0.0）
  - 实现计划：[docs/plan/20261007-1840-remove-model-profiles.md](plan/20261007-1840-remove-model-profiles.md)
  - 分支：`feat/remove-model-profiles`（自 `feat/configurable-shortcuts` 最新提交 `d038ffc` 切出）
  - 状态：📋 计划待审阅（审阅通过后开始编码）
