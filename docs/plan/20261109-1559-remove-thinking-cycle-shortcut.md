# 移除 `alt+t` 思考强度循环快捷键

> 状态：**已批准，实现完成**（2026-11-09 用户口头批准后编码；418 个测试全绿，`dist/index.js` 已重建，待用户手动验收）
> 日期：2026-11-09
> 计划分支：`refactor/remove-thinking-cycle-shortcut`（自 `fix/wrap-around-selector` 最新提交 `9f02f60` 切出）

## 0. 一页看懂

**做什么**：删掉插件自带的 `alt+t`（`shortcuts.cycleThinking`）思考强度循环快捷键。思考强度完全交还 pi 原生（`shift+tab` / `/thinking` / `/model`），插件不再持有这条绑定。

| 能力 | 现状 | 改完后 |
|---|---|---|
| 循环思考强度 | 插件 `alt+t` + pi 原生 `shift+tab`（功能重复） | 仅 pi 原生 `shift+tab` / `/thinking` |
| `shortcuts.cycleThinking` 配置 | 生效，默认 `alt+t` | 不再生效（旧配置静默忽略） |
| `/mode-hotkeys` | 3 行（正向 / 反向 / 思考强度） | 2 行（正向 / 反向） |
| 模式切换与思考强度的关系 | 已解耦（v3.0.0 起） | 不变 |
| footer 里的思考强度展示 | 显示 | 不变（保留） |

**关键铁律**

- 不新增任何替代性的思考强度绑定，也不改 `cycleMode` 的默认值。
- 旧配置文件必须继续静默可用：含 `cycleThinking` 的 `permission-modes.json` 不报错、不告警、不影响其它快捷键。
- 模式门禁、规则求值、分类器、快照/undo、打包方式零改动。

## 1. 背景（已核实）

- 该快捷键确实由本插件注册，默认值来自配置模块，`/mode-hotkeys` 表格第三行即它（与用户截图一致）。
- 它自 v1.0.0 初版就存在（`git log -S"cycleThinking"` 命中 `cb000b8`），从未读取模式或 profile 配置；与 v2.x 的 `model-profiles.json`（`ModeConfig.effort`）不是同一套，后者已在 v3.0.0 整体移除。
- v3.0.0 之后，插件内与思考强度相关的只剩两处：该循环本身，以及 footer 把当前档位拼进模型串的**只读展示**。
- pi 原生已提供等价能力：`app.thinking.cycle`（默认 `shift+tab`）、`/thinking` 命令、RPC `cycle_thinking_level`；插件里「pi has no built-in cycle helper」的注释已过期。
- 它当年存在的理由是 `shift+tab` 被模式环占用；而 pi 会把 `app.thinking.cycle` 保留的 `shift+tab` 从扩展注册中静默剔除，用户把 `cycleMode` 改到 `alt+x` 后 `shift+tab` 空闲，`alt+t` 遂成纯冗余绑定。
- 该问题已作为已知问题登记：`docs/issues/20261109-thinking-cycle-shortcut-redundant.md`（提交 `9f02f60`）。
- 现有测试里与它相关的断言分布在：配置解析（默认值 / 大小写归一 / `null` 禁用）、扩展级「默认快捷键已注册」、`/mode-hotkeys` 输出（4 个用例均不涉及思考强度行）。

## 2. 需求目标（验收标准）

1. 插件不再注册任何思考强度快捷键：默认配置下按 `alt+t` 无任何反应——不改思考强度、不弹通知、不改模式。
2. `/mode-hotkeys` 只列模式正向 / 反向两行，不再出现「Cycle thinking level」。
3. `shortcuts.cycleThinking` 不再生效：旧配置文件（含 `"cycleThinking": "alt+t"`、其它键或 `null`）加载时静默忽略，不报错、不告警、不影响其它快捷键的正常注册。
4. 思考强度仍可切换：pi 原生 `shift+tab` 与 `/thinking` 正常工作，插件不得注册、占用或改写这些绑定。
5. footer 仍显示当前思考强度，且与 pi 的实际状态一致。
6. 模式循环（正向 / 反向）、权限门禁、规则求值、分类器、快照与 undo 行为零变化。
7. README / CHANGELOG 不再把 `alt+t` 当作插件可用能力描述，并给出迁移提示（改用 pi 原生方式）。

## 3. 验证

- `npm test` 全绿（Windows 基线上已知的无关失败需对照基线说明）。
- 新增测试覆盖：
  - 配置解析：默认快捷键集合不再含 `cycleThinking`；含旧字段的配置解析不抛错。
  - 扩展级：`alt+t` 未被注册；模拟按下 `alt+t` 后模式与思考强度均不变。
  - `/mode-hotkeys`：输出不含思考强度行，仍含正向 / 反向两行。
- 既有断言同步更新（原先断言「默认 `alt+t` 已注册」与「默认值含 `cycleThinking`」的用例）。
- `npm run build` 重建 `dist/index.js`，与源码同一提交；`dist.test.ts` 逐字节新鲜度门禁通过；包体不超 `scripts/build.js` 的体积预算。
- 手动验收：`/reload` 后按 `alt+t` 无反应；`/mode-hotkeys` 只剩两行；pi 原生 `shift+tab` / `/thinking` 仍可切档；footer 的思考强度显示正常。

## 4. 文档同步

- `README.md`：「Model & thinking」段、命令 / 快捷键表、Custom shortcuts 的 JSON 示例与 Defaults 条目、`shift+tab` 冲突注记中「thinking-level cycling remains available on this extension's `alt+t`」的表述。
- `CHANGELOG.md`：`[Unreleased] → Removed` 记录移除范围与迁移方式。
- `docs/TODO.md`：本条目从「已知问题」移入「进行中」，状态随实现推进；**验收通过后**才勾选并移入「已完成」。
- `docs/issues/20261109-thinking-cycle-shortcut-redundant.md`：状态由「已知，暂不修复」改为「修复中」并链接本计划，修复后标注已修复。
- `docs/testing-configurable-shortcuts.md`：测试指南中 `alt+t` 与「三个字段」的描述同步为两字段。
- 不改 `docs/PRD.md`、`docs/prompts/`、`docs/suggestions.md`（原作者文档，只读）。

## 5. 明确不做的事

- 不提供 `shortcuts.cycleThinking` 的替代字段，也不调整 `cycleMode` 的默认值。
- 不动 footer 的思考强度展示逻辑。
- 不修改用户侧 `~/.pi/agent/keybindings.json`，不替用户解绑 / 重绑 pi 原生键。
- 不升版本号、不发 npm、不打 tag（发布动作由用户决定）。
- 不改 `AGENTS.md` / `CLAUDE.md`（除非用户明确要求）。
- 不顺手做「快捷键与配置清理」之外的重构。

## 6. 风险与备注

- **依赖 `alt+t` 的用户会失去该键**：迁移提示写入 README 与 CHANGELOG；pi 原生 `shift+tab` 默认可用，风险低。
- **若用户曾在 `keybindings.json` 中解绑 `app.thinking.cycle`**，移除后没有一键循环，只能走 `/thinking` 或 `/model`——文档需注明。
- **配置 schema 收缩**：选择「静默忽略旧字段」而非报错，避免破坏既有配置文件；这也是与「未知键应报错」取向的取舍，需要保持现状（当前加载器本就忽略未知键）。
- **版本语义**：按 Conventional 语义属「移除功能」，建议发布时升 minor（3.2.0）并在 CHANGELOG 标注；是否升 major 由用户决定。
- **文案漏改风险**：`/mode-hotkeys` 说明文字、README 多处表格容易漏，靠新增测试断言兜底。
