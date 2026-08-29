# 实现计划：permission-modes 支持自定义快捷键（默认保持 shift+tab）

> 状态：**待审阅**（审阅通过后才会开始编码实现）
> 日期：2026-08-29
> 计划分支：`feat/configurable-shortcuts`（自 `master` 切出）
> 对应 TODO：[docs/TODO.md](../TODO.md)

---

## 1. 背景与根因（已核实）

- 插件在 `index.ts:1392` / `index.ts:1436` / `index.ts:1469` 以硬编码字面量调用
  `pi.registerShortcut("shift+tab" | "alt+t" | "alt+i", ...)` 注册三个快捷键。
- pi 核心（`@earendil-works/pi-coding-agent`）把内置 action `app.thinking.cycle`
  默认绑定在 `shift+tab`，且该 action 位于扩展冲突保留名单
  `RESERVED_KEYBINDINGS_FOR_EXTENSION_CONFLICTS`
  （`pi/packages/coding-agent/src/core/extensions/runner.ts:76`）。
  命中保留名单的键，扩展注册的快捷键会被**静默丢弃**并输出警告
  `"Extension shortcut 'shift+tab' … conflicts with built-in shortcut. Skipping."`。
  因此插件的模式循环快捷键在默认 pi 环境下从未生效。
- 用户试图通过 `~/.pi/agent/keybindings.json` 写入
  `{"extension.permission-modes.cycle": "ctrl+shift+m"}` 来改键**无效**：
  keybindings.json 只认内置 action id（`app.*` / `tui.*`），未知 id 被静默忽略，
  扩展的 `registerShortcut` 注册的是原始按键字符串，不产生可被引用的具名 action。
- 插件自身的配置文件 `~/.pi/agent/permission-modes.json` 的 schema（`config.ts`）
  中没有任何快捷键字段，用户无法从插件侧自定义。

## 2. 目标

1. 在 `~/.pi/agent/permission-modes.json` 新增 `shortcuts` 配置段，三个快捷键均可自定义：
   - `cycleMode`（循环权限模式）
   - `cycleThinking`（循环 thinking level）
   - `cycleProfile`（循环模型 profile）
2. **不配置时默认值保持现状不变**：`shift+tab` / `alt+t` / `alt+i`，行为与当前版本完全一致。
3. 支持 `null` 禁用单个快捷键；配置值做 `trim().toLowerCase()` 归一化
   （pi 的键名均为小写，防止用户写 `"Shift+Tab"` 静默失效）。

## 3. Git 工作流

1. 当前工作区干净、位于 `master`，直接 `git checkout -b feat/configurable-shortcuts` 切出新分支。
2. 实现 + `npm test` 全量通过后，在该分支提交一次（提交信息风格仿照仓库历史：`feat: ...`）。
3. **不推送远程、不 bump 版本、不打 tag** —— 由用户 fork `GeorgeDong32/pi-permission-modes`
   后自行把分支推到 fork。

## 4. 代码改动

### 4.1 `config.ts` — 新增 shortcuts schema 与解析器

- 新增类型与常量：

  ```ts
  export interface ShortcutConfig {
    cycleMode: string | null      // null = 禁用
    cycleThinking: string | null
    cycleProfile: string | null
  }

  export const DEFAULT_SHORTCUTS = {
    cycleMode: "shift+tab",
    cycleThinking: "alt+t",
    cycleProfile: "alt+i",
  } as const
  ```

- `PermissionModesConfig` 增加可选字段：`shortcuts?: Partial<ShortcutConfig>`。
- 新增 `resolveShortcuts(config): ShortcutConfig`：
  - 字段未设置 → 使用 `DEFAULT_SHORTCUTS` 对应默认值；
  - 显式 `null` 或空白字符串 → 禁用（解析为 `null`）；
  - 其余值 → `trim().toLowerCase()` 归一化后返回。
- 缩进风格沿用 `config.ts` 现有的 tab 缩进。

### 4.2 `index.ts` — 接线

- 在 `config.ts` 导入块（`index.ts:32-36`）加入 `resolveShortcuts`。
- 工厂函数 `permissionModesExtension` 顶层（`index.ts:176-177` 附近）加载一次：

  ```ts
  const SHORTCUTS = resolveShortcuts(loadPermissionModesConfig())
  ```

  `/reload` 会重新执行工厂函数，因此配置改动**重载即生效**，无需额外逻辑。
- 三处硬编码注册改为配置驱动，值为 `null` 时跳过注册：

  ```ts
  if (SHORTCUTS.cycleMode) {
    pi.registerShortcut(SHORTCUTS.cycleMode, {
      description: "Cycle mode: Ask → Plan → Auto → Bypass",
      handler: async (ctx) => cycleMode(ctx),
    })
  }
  // alt+t / alt+i 同构
  ```

- 页脚提示 `index.ts:796` 的硬编码 `(shift+tab)` 改为动态渲染配置键
  （禁用时省略括号段）：`${m.icon} ${m.label}${SHORTCUTS.cycleMode ? ` (${SHORTCUTS.cycleMode})` : ""}`。
- 文件头注释 `index.ts:6` 的 "(Shift+Tab)" 标注为默认值、可配置。

### 4.3 测试

- **新建 `config.test.ts`**：`resolveShortcuts` 单元测试
  - 空配置 / 无 `shortcuts` 字段 → 全部回退默认值；
  - 逐键覆盖（如 `cycleMode: "ctrl+shift+m"`）；
  - `null` 与空串 → 解析为禁用；
  - `"Shift+Tab"` / `"  ctrl+shift+m "` → 归一化为小写去空白；
  - 未知字段被忽略、不影响其他键。
- **`index.test.ts`**：
  - 默认配置下断言 `pi.shortcuts.has("shift+tab")` 与 `has("alt+t")`
    （补齐现状只测了 `alt+i` 的空缺，见 `index.test.ts:1145`）；
  - 新增独立 describe 块（仿照 `index.test.ts:1747/1924` 的临时 config 模式，
    用 `mkdtempSync` + `setConfigPath` 写入 `{"shortcuts": {"cycleMode": "ctrl+shift+m"}}`）：
    断言注册了 `ctrl+shift+m`、未注册 `shift+tab`，
    且 `simulateShortcut("ctrl+shift+m", ...)` 能循环模式（ask → plan）；
  - 禁用用例：`{"shortcuts": {"cycleProfile": null}}` → `!shortcuts.has("alt+i")`。

### 4.4 文档

- **`README.md`**
  - `README.md:122-124` 快捷键表格三行注明"默认值，可配置"；
  - 新增 "Custom shortcuts" 小节：JSON 示例、默认值、`null` 禁用、`/reload` 生效；
  - 附注 pi 内置 `app.thinking.cycle` 占用 `shift+tab` 的冲突说明，及
    `~/.pi/agent/keybindings.json` 写 `{"app.thinking.cycle": []}` 释放按键的办法
    （即本次问题的根因，值得沉淀进文档）。
- **`CHANGELOG.md`**：顶部新增 `## [Unreleased]` → `### Added` 条目描述 `shortcuts` 配置。
  不修改既有版本号与 compare 链接（版本由仓库维护者发布时决定）。
- **`AGENTS.md`**：Commands 表中两行 Shortcut 更新为"默认 X，可经 `shortcuts` 配置"；
  Invariants 中补充一句：快捷键配置位于 `~/.pi/agent/permission-modes.json` 的 `shortcuts` 段。

## 5. 验证

1. 仓库当前无 `node_modules`，先 `npm install`。
2. `npm test` 全量通过（现有全部用例 + 新增用例）。
3. 手动验证路径（可选，由用户执行）：在 `~/.pi/agent/permission-modes.json` 写入
   `{"shortcuts": {"cycleMode": "ctrl+shift+m"}}`，`/reload` 后按新键循环模式。

## 6. 明确不做的事

- 不 bump `package.json` 版本号、不打 git tag、不推送任何远程。
- 不改变默认行为：无 `shortcuts` 配置时，三个快捷键与当前版本完全一致。
- 不在插件内做冲突检测（无法感知 pi 解析后的键位表，保持扩展边界）。

## 7. 风险与备注

- `registerShortcut` 的 `shortcut: KeyId` 参数类型若为严格联合类型，传入动态
  `string` 可能需要 `as KeyId` 断言（测试 mock 签名为 `key: string`，风险低，
  实现时视类型情况处理）。
- 本地修复方案（与本次插件改动互补，用户已完成）：在
  `~/.pi/agent/keybindings.json` 写 `{"app.thinking.cycle": []}` 释放 `shift+tab`
  给插件；thinking 循环仍可用插件注册的 `alt+t`。
