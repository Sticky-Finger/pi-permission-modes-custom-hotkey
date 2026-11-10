# `alt+t` 思考强度循环快捷键与 pi 原生功能重复

> 状态：**已修复并验收**（3.2.0 移除 `shortcuts.cycleThinking` / `alt+t`；用户于 2026-11-09 用 `pi -ne -e ./dist/index.js` 实机验证通过）
> 记录日期：2026-11-09
> 关联：model-profile 移除（[20261007-1840-remove-model-profiles.md](../plan/20261007-1840-remove-model-profiles.md)）、可配置快捷键（[20260829-2239-configurable-shortcuts.md](../plan/20260829-2239-configurable-shortcuts.md)）、修复计划（[20261109-1559-remove-thinking-cycle-shortcut.md](../plan/20261109-1559-remove-thinking-cycle-shortcut.md)）

## 问题

本插件注册的 `alt+t`（`shortcuts.cycleThinking`）只是 `pi.setThinkingLevel()` 的通用循环器，与权限模式没有任何耦合：

- 注册点 `index.ts:1515` `registerConfiguredShortcut("cycleThinking", …)`，默认值 `config.ts:52`（`cycleThinking: "alt+t"`）；
- 实现 `index.ts:1487` `cycleThinkingLevel()`：读 `getThinkingLevel()` → 在 `THINKING_LEVELS`（`off`→`xhigh`）里逐档 `setThinkingLevel()` 试探，跳过被模型 clamp 掉的档位；
- 它从 v1.0.0 初版（`cb000b8`）就存在，从未读取模式/配置，也不属于 v2.x 的 `model-profiles.json` 体系（那套走的是 `ModeConfig.effort`，已在 v3.0.0 移除）。

也就是说：**v3.0.0 之后，插件里唯一与 thinking 相关的行为就是这个循环 + footer 的只读展示（`index.ts:768-772` 把 thinking 拼进模型串）**，模式切换完全不碰思考强度。

## 影响

- pi 原生已提供同等能力：`app.thinking.cycle`（默认 `shift+tab`）、`/thinking` 命令、RPC `cycle_thinking_level`。`index.ts:1476` 的注释「pi has no built-in cycle helper」已过期。
- 唯一差异是插件的 set-then-get 探测，但 pi 原生循环本就只在模型支持的档位间切换，故无额外价值。
- 当初存在的理由（`shift+tab` 被模式环占用）也已消失：pi 的 `app.thinking.cycle` 保留 `shift+tab`，会静默挡掉绑定到该键的扩展快捷键；用户把 `cycleMode` 改到 `alt+x` 后 `shift+tab` 空闲，`alt+t` 成为纯冗余绑定。
- 冗余带来额外成本：一个常驻快捷键、`/mode-hotkeys` 的一行、`ShortcutConfig` 字段与测试、文档多处提及，且需持续维护「不安全按键」校验路径。

## 复现

1. 确认 `~/.pi/agent/permission-modes.json` 未禁用 `shortcuts.cycleThinking`（默认 `alt+t`）；
2. `/mode-hotkeys` 显示 `Cycle thinking level · shortcuts.cycleThinking | Alt+T | active`；
3. 对比 pi 原生：`shift+tab`（`app.thinking.cycle`）或 `/thinking` 得到相同结果。

## 修复方向（已落地）

- 删除 `cycleThinkingLevel()` 与对应注册，从 `/mode-hotkeys` 表格与 `ShortcutField` 联合中删掉 `cycleThinking`；
- 兼容性：保留 `shortcuts.cycleThinking` 字段的解析（避免旧配置出现未知键），但不再注册；或仅在检测不到 pi 原生 `app.thinking.cycle` 时才注册；
- 同步更新 `config.test.ts` 四处断言、README / AGENTS.md / `docs/testing-configurable-shortcuts.md` 的相关段落。

## 修复结果（3.2.0）

- 插件不再注册任何思考强度快捷键：`ShortcutField` 只剩 `cycleMode` / `cycleModeReverse`，循环实现与 `THINKING_LEVELS` 一并删除；
- 旧配置兼容：`shortcuts.cycleThinking` 静默忽略（不报错、不告警、不影响其它键），`config.test.ts` 与 `index.test.ts` 各有用例覆盖；
- `/mode-hotkeys` 只剩正向 / 反向两行（新增用例断言行数为 2、输出不含 `cycleThinking` / `alt+t`）；
- 文档同步：README（Model & thinking、快捷键表、Custom shortcuts、`shift+tab` 注记）、CHANGELOG `[Unreleased] → Removed`、`docs/testing-configurable-shortcuts.md`（标注历史 + 字段表更新）、`docs/README.md` 索引描述；
- 验证：418 个测试全绿，产物 90,798 B / 31,474 B gzip，三道构建门禁全过。

## 恢复条件（若日后需要）

仅当 pi 移除 `app.thinking.cycle` / `/thinking` 且仍希望插件提供该能力时，才考虑重新引入（届时按新需求立项，不要直接回滚本提交）。
