# 实现计划：权限模式支持逆序循环（可配置反向快捷键，默认关闭）

> 状态：**已批准并实现（修订 2）**——反向改为与正向对称的双向环绕，去掉 `ask` 处钳制；待用户实机手动验收
> 日期：2026-11-09
> 计划分支：`feat/reverse-mode-cycle`（自 `fix/wrap-around-selector` 最新提交 `b055648` 切出）
> 对应 TODO：[docs/TODO.md](../TODO.md)

---

## 0. 一页看懂

**做什么**：
1. 给模式循环加一个**可选、可配置的反向快捷键**（`shortcuts.cycleModeReverse`），按反方向走同一圈 `MODE_CYCLE`；**默认不启用**，不新增任何模式切换命令。
2. 新增一个**只读查看命令** `/mode-hotkeys`，列出本插件配置的快捷键及"到底注册上没有"，显示形式参考 pi 自带 `/hotkeys`（markdown 表格）。

**用户主诉**：现在只能正向切（`ask → readonly → plan → auto → bypass`），从 `ask` 切到 `readonly` 后想退回 `ask` 要按 4 次；希望一次反向键就回去，按多了还能再正向修回来。反向键是可选功能，不该常驻界面干扰用户，所以需要一个按需查看的地方。

| 场景 | 现状（3.1.0） | 改完后 |
|---|---|---|
| `ask` → `readonly`（正向键一次） | `readonly` | 同左（**不变**） |
| 想回 `ask` | 再按 4 次正向键（`plan → auto → bypass → ask`） | 配好反向键后按 1 次 → `ask` |
| 反向按多了 | 不存在 | 再按正向键即可修回（两向对称、都可回退一步） |
| 在 `ask` 上按反向键 | 不存在 | **环绕到 `bypass`**（与正向 `bypass → ask` 完全对称） |
| 不配置 `cycleModeReverse` | 只有正向键 | **与 3.1.0 完全一致**：不注册、不告警、页脚不变 |
| 想确认反向键配没配上 | 只能翻配置文件猜 | `/mode-hotkeys` 显示键位 + 状态（active / not configured / refused …） |
| 终端发不出该组合键 | — | 只能改用终端能发出来的键（**不做命令兜底**，见 §5） |

**铁律**：
- 正向循环行为、顺序、副作用**零变化**（`MODE_CYCLE` 与正向 `cycleMode` 路径不动）。
- 模式切换仍然**绝不触碰 model / thinking level**。
- 反向切换复用同一条 `setMode()` 路径：持久化、工具集、plan 文件、子代理继承、提醒注入全部一致，不允许出现"反向专属副作用"。
- **双向完全对称**：两个方向都在环上取模环绕，没有任何方向专属的边界规则（§2.3）。
- **不新增任何模式切换命令**（正向循环本来也只有快捷键），只新增一个只读的 `/mode-hotkeys` 查看命令。
- **不常驻界面**：页脚保持现状（只显示正向键），反向键信息只在用户主动运行 `/mode-hotkeys` 时出现。
- 未配置 = 静默关闭：不注册快捷键、不产生 warning、不在任何地方出现。只有用户**显式配置了非法值**时才告警。
- `/mode-hotkeys` 展示的必须是**真实注册结果**（与页脚同源），不能只回显配置文件，否则会出现"显示已配置、实际没生效"的误报。
- 按 `WORKFLOW.md` §6，**不改** `AGENTS.md` / `CLAUDE.md`（原项目文件，除非用户明确要求）。

---

## 1. 背景（已核实）

- 循环顺序与正向入口：`index.ts:144` 的 `MODE_CYCLE = ["ask","readonly","plan","auto","bypass"]`；`index.ts:728` 的 `cycleMode()` 原为单向 `(idx + 1) % length`。
- 正向循环**没有专属命令**：只有 `/ask`、`/readonly` 等按名切换命令与 `/mode` 选择器（`index.ts:924-975`），没有任何"切到下一个模式"的命令。
- 快捷键配置：`config.ts:36-46`（`ShortcutConfig` / `DEFAULT_SHORTCUTS`）、`config.ts:58-64`（`resolveShortcuts`：缺省回退默认、`null`/空白禁用、`trim().toLowerCase()` 归一化）；`index.ts:187` 在工厂加载时解析一次，`index.ts:1302-1330` 的 `registerConfiguredShortcut()` 统一注册，`key === null` 时直接跳过、不告警，注册成功的键记录在 `registeredShortcuts`（页脚提示也读这份记录）。
- 安全键守卫：`config.ts:80-105` 的 `isUnsafeShortcutKey()` 拒绝终端控制字符别名（`ctrl+m`=Enter、`ctrl+i`=Tab、`ctrl+j`、`ctrl+h`、`ctrl+[`）与裸/`shift+` 单字符（会吃掉打字）。被拒的键只进 `shortcutWarnings`，不注册。
- 页脚提示：`index.ts:761-762` 用 `registeredShortcuts.cycleMode` 渲染 `◐ Read Only (shift+tab)`；`index.ts:770-815` 的窄屏分支只截断 model 一侧。
- 命令实现范式（本插件内已有先例）：`/permissions`（`index.ts:930-950`）在 `ctx.hasUI` 时用 `pi.sendMessage({ customType, content: "**…**\n\n```\n…\n```", display: true }, { triggerTurn: false })` 把结果作为消息渲染，无 UI 时 `console.log`。pi 的 `/hotkeys` 在 `interactive-mode.js:5306-5372` 用 markdown 表格 + 边框面板渲染，并包含一个 **Extensions** 表格（`| Key | Action |`，key 经 `formatKeyText(key, { capitalize: true })` 美化）；该面板是 pi 内部 TUI 组件，扩展拿不到，因此本命令用 `sendMessage` + markdown 表格对齐同一观感。
- `formatKeyText`（`pi-coding-agent/dist/modes/interactive/components/keybinding-hints.js`）的规则：按 `/` 与 `+` 切分，`capitalize: true` 时每段首字母大写，macOS 上 `alt` 显示为 `option`。本命令按同样规则做一份本地轻量格式化（不引入 pi 内部模块）。
- pi 键位事实（已在 `node_modules` 核实）：
  - 扩展冲突保留名单见 `pi-coding-agent/dist/core/extensions/runner.js:7-26`，含 `app.thinking.cycle`（默认 `shift+tab`）→ 插件默认正向键在原生 pi 上**本来就会被静默丢弃**（README 已注明）。
  - pi 自身的反向循环惯例是 `app.model.cycleBackward` = `shift+ctrl+p`（正向 `ctrl+p` 加 `shift`）。
  - 键位解析（`pi-tui/dist/keys.js` 的 `parseKeyId`）：按 `+` 切分后用 `includes()` 判定修饰键，**顺序无关**，文档明确支持 `shift+ctrl+p` / `ctrl+alt+x` 这类多修饰组合。
  - `pi-tui/dist/keys.js`：单修饰的 `alt+字母`（ESC+字母）、`ctrl+字母`（控制字符）、`ctrl+alt+字母`（ESC+控制字符）有 **legacy 编码，多数终端可用**；`shift+alt+字母`、`ctrl+shift+字母`、`ctrl+tab`、`ctrl+shift+tab` 等**双修饰/带修饰 Tab** 依赖 Kitty 键盘协议或 xterm `modifyOtherKeys`，老终端可能**根本不产生按键事件**。
- 用户实测反馈（2026-11-09）：把 `cycleModeReverse` 配在 `permissions.shortcuts` 下时 `/mode-hotkeys` 显示 `not configured (optional)`——层级写错时配置被静默忽略（`permissions` 段只认 `allow`/`deny`/`ask`）；把键移到顶层 `shortcuts` 后立即生效。说明配置诊断体验有改进空间（见 §5/§6）。
- 测试现状：`index.test.ts:1919-2000`（快捷键配置段，`pi.shortcuts` Map + `simulateShortcut`）、`index.test.ts:2013-2065`（循环顺序段，用 `shift+tab` 驱动、断言持久化的 `currentMode`）、`config.test.ts` 用 `toEqual` 精确比对默认值对象（新增字段必须同步更新，否则立刻红）。
- 产物门禁：`dist/index.js` 是唯一发布物，`dist.test.ts` 做逐字节新鲜度 + 体积预算校验，改源码后必须 `npm run build` 并提交产物。

---

## 2. 需求目标（验收标准）

### 2.1 配置项（默认关闭）

1. `~/.pi/agent/permission-modes.json` 的 `shortcuts` 段新增 `cycleModeReverse`，**默认值 `null`（不注册）**。
2. 未配置 / `null` / 空白字符串 → **静默禁用**：不注册快捷键、不打印 warning、会话启动无提示、页脚与 `/mode-hotkeys` 只显示"未配置"而不告警。
3. 配置有效值 → `trim().toLowerCase()` 归一化后注册；`/reload` 后生效（沿用工厂重载）。
4. 用户显式配置了**不安全键**（`isUnsafeShortcutKey()` 判定）→ **不注册**，stderr + 会话启动 UI 各告警一次（与 `cycleMode` 现有行为一致；仅针对显式配置的非法值）。
5. 反向键与正向键**同值** → 只注册正向（避免互相覆盖），并告警说明。
6. 该功能定位为**交互改善**：不配置时插件功能完全不受影响，也不产生任何噪音。

### 2.2 反向语义

7. 反向一次 = `MODE_CYCLE` 上倒退一格：`bypass → auto → plan → readonly → ask`；核心验收用例：**`ask` 正向到 `readonly`，反向一次回到 `ask`**。
8. 反向切换的持久化、工具集增删、plan 文件、`PERMISSION_MODES_INHERITED_MODE` 发布、提醒注入、通知文案，与正向**完全一致**（同一 `setMode` 路径），且不调用 `setModel` / `setThinkingLevel`。
9. 连续"正向按多了"可用反向逐格修回，反之亦然（双向都可回退一步）。

### 2.3 边界：双向对称环绕（去掉 `ask` 钳制）

10. **两个方向都在环上取模环绕，没有方向专属的边界规则**：
    - 正向：`bypass → ask`（既有行为，不变）；
    - 反向：`ask → bypass`（本次修订新增，与正向完全对称）。
11. **`ask` 处不再钳制**。上一版曾要求"反向在 `ask` 上停留并提示 `already first`"，该设计被废弃，理由（已与用户确认）：
    - 它**不构成任何安全边界**——用户用 `/mode bypass` 或正向连按同样能到 `bypass`，禁止反向走一格只是掩耳盗铃；
    - 真正的护栏是"进入 bypass 时的安全提醒 + 页脚常显当前模式"，与到达路径无关；
    - 代价却是环的对称性被破坏、连按时表现为"卡住"，与"快速来回切"的初衷冲突。
12. 反向与正向的通知文案保持一致（`Mode: <label>`）；`already first` 分支及其提示**删除**。

### 2.4 UI（不常驻）

13. 页脚**保持现状**：只显示正向键（`◐ Read Only (shift+tab)`），不加入反向键、不加 `⇄` 之类常驻提示。
14. 反向键的存在与状态只在用户主动运行 `/mode-hotkeys` 时呈现；反向未配置时页脚与 3.1.0 完全一致。

### 2.5 查看命令 `/mode-hotkeys`

15. 新增只读命令 `/mode-hotkeys`（描述：查看本插件配置的快捷键及其注册状态），无副作用、不切换模式、不写文件。
16. 显示形式对齐 pi 自带 `/hotkeys`：标题 + markdown 表格（`Action` / `Key` / `Status`），键名按 `formatKeyText` 规则美化（每段首字母大写，macOS 上 `alt` 显示为 `option`）。示例（正向默认、反向未配置）：

    ```
    **Permission-modes shortcuts**

    | Action | Key | Status |
    |---|---|---|
    | Cycle mode (forward) · shortcuts.cycleMode | `Shift+Tab` | active |
    | Cycle mode (reverse) · shortcuts.cycleModeReverse | — | not configured (optional) |
    | Cycle thinking level · shortcuts.cycleThinking | `Alt+T` | active |

    Config: ~/.pi/agent/permission-modes.json · run /reload after edits
    ```

17. 状态取值至少覆盖：`active`（已注册）、`not configured (optional)`（未配置/`null`）、`disabled`（显式空白）、`refused (unsafe key)`（被安全守卫拒绝）、`not registered (same as forward)`（与正向同值）。被拒/冲突的具体原因以简短说明附在表格下方（与启动告警同源）。
18. 数据来源必须是**真实注册结果**（`registeredShortcuts` + 解析后的配置 + `shortcutWarnings`），不得仅回显配置文件。
19. 无 UI 时退化为 `console.log`（与 `/permissions` 一致），不阻塞、不抛错。

### 2.6 入口范围

20. 除 `/mode-hotkeys` 外**不新增任何命令**：不新增 `/mode prev`、`/mode next` 之类切换命令，模式切换的既有命令面（`/ask` 等 + `/mode` 选择器）保持不变。

---

## 3. 验证

1. `npm test` 全绿（含新增/修订用例）。
2. 用例清单（沿用现有 fake-pi / `makeCtx` 模式）：
   - `config.test.ts`：默认值中 `cycleModeReverse` 为 `null`；单键覆盖不影响其他键；`null`/空白禁用；大小写与空白归一化；未知字段忽略。
   - `index.test.ts`：
     - **未配置时**：反向键未注册，且 `console.warn` 未被调用（无噪音）；
     - 配置 `{"shortcuts":{"cycleModeReverse":"alt+shift+x"}}` → 注册成功，且正向默认键仍注册；
     - 反向链 `bypass → auto → plan → readonly → ask`（从 `bypass` 起连按）；
     - 主诉用例：正向一次到 `readonly`，反向一次回 `ask`；
     - **`ask` 上反向 → `bypass`**（双向对称环绕，取代上一版的"钳制不动"用例）；
     - 正向 `bypass → ask` 环绕回归不变（既有用例保持）；
     - 反向切换后 `pi.setModelCalls` 为空、`thinkingLevel` 不变；
     - 显式配置不安全反向键（如 `ctrl+m`）→ 不注册且告警；
     - 正反同值时只注册正向且告警；
     - `/mode-hotkeys`：未配置时输出包含正向键与 `not configured`；配置 `alt+shift+x` 后输出包含美化后的 `Alt+Shift+X` 且状态为 `active`；配置不安全键时输出包含 `refused` 与原因；正反同值时输出 `not registered (same as cycleMode)`；断言 `customType`/`triggerTurn: false` 且不产生 `setModel`/模式切换副作用。
3. `npm run build` 重建 `dist/index.js` 并提交；`dist.test.ts` 新鲜度与体积预算通过（体积变化在 CHANGELOG 记一句，若超预算按 `scripts/build.js` 规则小幅上调）。
4. 手工验收（用户执行）：在 `~/.pi/agent/permission-modes.json` 的**顶层** `shortcuts` 段配 `"cycleModeReverse": "alt+ctrl+x"`（或终端可用的其他键），`/reload` 后运行 `/mode-hotkeys` 确认 `active`，再实机确认：`ask → readonly`（正向一次）→ `ask`（反向一次），以及在 `ask` 上反向一次到达 `bypass`。
5. 基线说明：Windows 上既有与本次无关的失败按 `docs/TODO.md` 基线对照说明，不混入本次改动。
6. **TODO 状态推进规则（用户要求，已写入 `WORKFLOW.md` §3）**：编码完成、`npm test` / `npm run build` 全绿后，条目仍留在 `## 进行中`，状态写 `🚧 编码中（待用户手动验收）` 并附测试/产物数据；**只有用户实机手动验收通过并明确确认后**，才由用户（或经用户授权）把条目勾选并移入 `## 已完成`。不得由实现方自行标为 ✅ 完成。

---

## 4. 文档同步

- `README.md`：模式循环段落（双向说明 + 反向默认关闭）、快捷键表格新增一行（标注"可选，默认未配置"）、"Custom shortcuts" 小节补 `cycleModeReverse` 可直接复制的示例、命令表新增 `/mode-hotkeys`（含一行输出示例）、终端键位可达性说明（双修饰键需 Kitty/modifyOtherKeys；legacy 可用的含单修饰键与 `ctrl+alt+字母`）、**删除"`ask` is the floor"钳制说明，改为双向环绕**。
- `CHANGELOG.md`：`[Unreleased]` → `Added`（可选的反向循环快捷键，默认关闭；`/mode-hotkeys` 查看命令）；反向条目里删除 `ask` 钳制描述，明确"与正向对称环绕"。
- `docs/TODO.md`：条目移回 `## 进行中` 并标注本次修订状态（计划待审阅 → 编码中 → 完成）。
- `index.ts` 文件头注释：五模式循环说明补"正向/反向两个快捷键（反向默认关闭，用 `/mode-hotkeys` 查看）"。
- `docs/prompts/*.md`：**无需改动**（模式行为与提示注入均不变）。
- `AGENTS.md` / `CLAUDE.md`：**不改**（按 `WORKFLOW.md` §6，除非用户明确要求）。

---

## 5. 明确不做的事

- **不做模式切换命令**：不做 `/mode prev`、`/mode next` 之类兜底命令（正向循环同样没有专属命令，保持入口面一致；键盘不可用时用户可自行换键或点 `/mode` 选择器）。唯一新增命令是只读的 `/mode-hotkeys`。
- **不在页脚常驻展示反向键**：不把可选功能的键位塞进每屏都可见的页脚。
- **不做"反向边界钳制"**：上一版设计的"`ask` 处停留并提示 `already first`"明确废弃（§2.3）。
- 不做"模式历史栈 / 回到上一个模式"（`toggle last mode`）：语义与"逆序一格"不同，会把简单可预测的环变成有状态栈；本需求的"按多了再修回来"用双向环已满足。
- 不做"同键双击反向"：时序判定不可靠，且与用户快速连按的正常操作直接冲突。
- 不改 `MODE_CYCLE` 顺序。
- 不给 `cycleThinking` 加反向（本需求不涉及；如需要另行立项）。
- **本次不做配置校验/诊断告警**（用户把键写进 `permissions.shortcuts` 被静默忽略）：属于独立的配置诊断改进，另立计划（§6 备注已记录）。
- 不做工具过滤、不碰权限规则求值顺序、不改 classifier。
- 不 bump 版本号、不打 tag、不推送远程（由用户决定发布与推送）。

---

## 6. 风险与备注

- **默认关闭意味着要用户手动配置**：符合"小功能、不影响不用它的人"的定位，但发现性依赖 README 与 `/mode-hotkeys`；文档要给出可直接复制的配置块，并在 CHANGELOG 里点明"默认不生效"。
- **终端可达性是最大不确定项**：`alt+ctrl+x` 有 legacy 编码（ESC + 控制字符），多数终端可用；`alt+shift+x`、`ctrl+shift+tab` 依赖 Kitty 协议或 `modifyOtherKeys`。`/mode-hotkeys` 只能证明"插件侧注册成功"，**不能证明"终端能发出来"**——README 必须写清这一点，并给出替代键，避免用户把"按键没反应"误判为插件 bug。
- **状态显示必须与真实注册同源**：若只回显配置，会出现"显示 active 但实际被安全守卫拒了"的假象。因此展示以注册记录为准，并把被拒/冲突原因一并列出。
- **误触到 `bypass` 的风险**：双向环绕后，`ask` 上误按反向键会进入 `bypass`。这与用户用 `/mode bypass`、或正向连按的到达路径一致，靠"进入 bypass 的安全提醒 + 页脚常显模式"承担，而不是靠禁止某条路径（§2.3）。
- **配置层级写错的静默忽略**（实测已踩到）：`permissions` 段只认 `allow`/`deny`/`ask`，写在 `permissions.shortcuts` 下的键不会生效且无告警。本次只通过 `/mode-hotkeys` 暴露"未配置"，配置校验/诊断告警另立计划。
- **既有精确断言**：`config.test.ts` 的 `toEqual` 与 `index.test.ts` 的默认键断言会因新增字段而变化，属预期，需一并更新；`index.test.ts` 循环用例仍用 `shift+tab`，正向不受影响。
- **为什么默认 `null` 而不是给个默认键**：`shift+tab`/`ctrl+shift+tab` 在原生 pi 上要么被保留键吞掉、要么老终端发不出来，给默认值反而制造"配了却没反应"的困惑；让用户按自己的终端与正向键成对配置更诚实。

---

## 7. 修订记录

| 版本 | 审核意见 | 处理 |
|---|---|---|
| v1 | 不做 `/mode prev` 之类命令；反向快捷键默认空/不配置时不告警 | 删除命令兜底方案；`cycleModeReverse` 默认 `null`，未配置零噪音；新增只读 `/mode-hotkeys` 供按需查看 |
| v2（本次） | `ask` 处禁止反向环绕是掩耳盗铃（`/mode`、正向连按都能到 `bypass`），要求双向对称 | 废弃 §2.3 的钳制，改为双向取模环绕（`ask → bypass`）；删除 `already first` 分支；同步测试与 README/CHANGELOG 表述 |
