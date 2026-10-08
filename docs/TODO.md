# TODO

> 待办事项清单。勾选格式：`- [ ]` 未完成 / `- [x]` 已完成。
> 每项任务如有实现计划，在子项中以链接形式引入 `docs/plan/` 下的计划文档。

## 进行中

- [ ] [Build] 插件代码打包压缩：pi 改为加载单文件 `dist/index.js`（1 个模块、零 jiti 转译，22 个 TS → 1 个 bundle）
  - 实现计划：[docs/plan/20261007-2115-dist-bundle.md](plan/20261007-2115-dist-bundle.md)
  - 分支：`feat/dist-bundle`（自 `feat/remove-model-profiles` 最新提交 `ce4cd4d` 切出）
  - 状态：📋 计划待审阅（已定：`dist/` 必须入库 + 极致档全量 minify + prompt `?raw` 内联成真·单文件；§3.7 硬不变量：**产物不依赖任何外部解析**（第三方代码一律内联进 `dist/index.js`，禁止外置 import）+ 内联内容账实相符（`INLINED_THIRD_PARTY` 清单门禁）+ 字节固定（精确锁版 esbuild + 新鲜度比对）+ **源码侧 lock 入库**（`package-lock.json` 从 `.gitignore` 移出、统一 `npm ci`）。体积：22 个 TS 203 KB → 1 个 JS 83 KB / gzip 28.9 KB）

- [x] [Feature] 支持自定义快捷键（`shortcuts` 配置段；默认保持 `shift+tab` / `alt+t` / `alt+i` 不变）
  - 实现计划：[docs/plan/20260829-2239-configurable-shortcuts.md](plan/20260829-2239-configurable-shortcuts.md)
  - 分支：`feat/configurable-shortcuts`（已提交，未推送远程，待用户推到 fork）
  - 状态：✅ 编码实现完成，新增 12 个测试全部通过（Windows 基线上既有的 24 个失败与本次改动无关，已用基线对照确认）

- [x] [Refactor] 彻底移除 model-profile 功能（切权限模式不再切换模型与思考强度；v3.0.0）
  - 实现计划：[docs/plan/20261007-1840-remove-model-profiles.md](plan/20261007-1840-remove-model-profiles.md)
  - 分支：`feat/remove-model-profiles`（自 `feat/configurable-shortcuts` 最新提交 `d038ffc` 切出）
  - 状态：✅ 编码实现完成，298 个测试全部通过（含修复一个在 pi 会话内跑套件时暴露的 mode-inherit 测试隔离问题）；待推送远程（fork + origin）
