# 测试指南：可配置快捷键（configurable-shortcuts 分支）

> 日期：2026-08-29
> 分支：`feat/configurable-shortcuts`（功能提交 `c3527ba`，基于 `master`，未推送远程）
> 实现计划：[docs/plan/20260829-2239-configurable-shortcuts.md](plan/20260829-2239-configurable-shortcuts.md)
> 环境：Windows 10，pi 0.84.4，已全局安装 npm 发布版 `@georgedong32/permission-modes@2.6.3`

---

## 1. 背景：为什么要做这个功能

- 插件原来在 `index.ts` 里**硬编码**注册三个快捷键：`shift+tab`（循环模式）、
  `alt+t`（循环 thinking）、`alt+i`（循环模型 profile）。
- pi 核心把内置 action `app.thinking.cycle` 默认绑在 `shift+tab`，且该 action 在
  **扩展冲突保留名单**里（`runner.ts` 的 `RESERVED_KEYBINDINGS_FOR_EXTENSION_CONFLICTS`）。
  凡命中保留名单的键，扩展注册的快捷键会被**静默丢弃**，启动时输出
  `"Extension shortcut 'shift+tab' … conflicts with built-in shortcut. Skipping."`。
  因此默认环境下插件的模式循环快捷键从未生效过。
- 用户试图用 `~/.pi/agent/keybindings.json` 改键**无效**：该文件只认 pi 内置
  action id（`app.*` / `tui.*`），不认识的 id 被静默忽略；扩展 `registerShortcut`
  注册的是原始按键字符串，不产生可被引用的具名 action。
- keybindings.json 唯一的正确用法是**释放按键**：写 `{"app.thinking.cycle": []}`
  禁用内置 thinking 循环后，`shift+tab` 不再保留，插件的注册即可成功
  （本机已完成此步骤；thinking 循环仍有插件的 `alt+t` 可用）。
- 本次改动：新增 `shortcuts` 配置段，三个快捷键均可自定义/禁用，
  **不配置时默认值与行为和旧版完全一致**。

## 2. 功能速览

配置文件：`C:\Users\wpw\.pi\agent\permission-modes.json`（固定路径，**不需要写插件名**）

```json
{
  "shortcuts": {
    "cycleMode": "ctrl+shift+m",
    "cycleThinking": "alt+t",
    "cycleProfile": "alt+i"
  }
}
```

| 字段 | 作用 | 默认值 |
|---|---|---|
| `cycleMode` | 循环权限模式 ● Ask → ⏸ Plan → ▶ Auto → ⚡ Bypass | `shift+tab` |
| `cycleThinking` | 循环 thinking 等级 | `alt+t` |
| `cycleProfile` | 循环模型 profile | `alt+i` |

规则：

- 只写想改的键，未写的用默认值；值写 `null`（或空白串）表示**禁用**该快捷键。
- 配置值自动 `trim + 转小写`（写 `"Shift+Tab"` 等价于 `"shift+tab"`）。
- 页脚第二行的模式提示跟随配置的 `cycleMode` 键（禁用时不显示括号段）。
- 配置为**全局**生效（所有项目共用这一个文件；项目级 `.pi/projects/<id>/`
  只放 allow/deny/ask 权限规则，与快捷键无关）。
- 修改配置后在会话里执行 `/reload` 即生效（`/reload` 会重跑扩展工厂函数）。
- 旧版 npm 2.6.3 不认识 `shortcuts` 字段会直接忽略——这份配置对发布版无副作用。

> 注意区分两个文件：`keybindings.json` 是 **pi 核心内置 action** 的键位表
> （只能重映射/禁用内置 id）；`permission-modes.json` 是**本插件自己的**
> 配置文件，插件按固定路径读取，与插件叫什么名字、以什么方式加载完全无关。

## 3. 测试加载方式（不卸载 npm 发布版）

本机 settings.json 的 `packages` 里已装 `npm:@georgedong32/permission-modes`（2.6.3）。
测试时**不卸载**，用 pi 的会话级按需加载机制把 npm 版"跳过"、临时加载仓库版：

```bash
pi -ne -e "D:/ubuntu_docs/Codes/To-Study/pi-permission-modes/index.ts"
```

- `-ne`（`--no-extensions`）：本次启动跳过所有"被发现"的扩展
  （settings.json 里 npm 包注册的扩展、`~/.pi/agent/extensions/` 自动发现、
  项目级 `.pi/extensions/`），但显式 `-e` 的路径仍然加载。
  源码依据：`resource-loader.ts:451-453`；已在本机 pi 0.84.4 `--help` 验证。
- `-e <仓库>/index.ts`：加载当前代码库的插件。
- npm 包在 settings.json 里原封不动：平时直接 `pi` 启动照旧加载 2.6.3，
  只有带 `-ne -e` 的会话切到仓库版，关掉会话即恢复，零安装状态变更。

**副作用提醒**：`-ne` 是"全有或全无"——该测试会话里其他已装包
（`pi-mcp-adapter`、`pi-web-access`）注册的**扩展**部分也会被一并跳过；
skills/prompts/themes 不受影响（它们有独立的 `--no-skills` 等开关）。
pi 目前没有"只排除某个包"的 CLI 参数（`pi config` TUI 的按包启停是持久配置），
所以测试会话用 `-ne -e` 是最干净的官方机制。

**建议加 alias**（git bash，写入 `~/.bashrc`）：

```bash
alias pitest='pi -ne -e "D:/ubuntu_docs/Codes/To-Study/pi-permission-modes/index.ts"'
```

PowerShell 版：

```powershell
function pitest { pi -ne -e "D:\ubuntu_docs\Codes\To-Study\pi-permission-modes\index.ts" @args }
```

可选（长期常驻替代方案）：把仓库以目录联接挂进自动发现目录
（Junction 无需管理员权限），改代码后 `/reload` 即生效：

```powershell
New-Item -ItemType Junction -Path "$env:USERPROFILE\.pi\agent\extensions\permission-modes" -Target "D:\ubuntu_docs\Codes\To-Study\pi-permission-modes"
```

（用 Junction 方案时同样建议先 `-ne` 或停用 npm 版，避免双份加载。）

## 4. 验证清单

前置：新建 `C:\Users\wpw\.pi\agent\permission-modes.json`（本机原本不存在），
写入上面的 `shortcuts` 示例（至少含 `"cycleMode": "ctrl+shift+m"`）。

1. `pitest` 启动 → `pi list` 确认扩展已加载。
2. **启动横幅不再出现** `Extension shortcut 'shift+tab' … conflicts with
   built-in shortcut. Skipping.` 警告——警告消失即说明冲突已绕开。
3. 按 `ctrl+shift+m`：模式依次循环 ● Ask → ⏸ Plan → ▶ Auto → ⚡ Bypass，
   且页脚第二行显示 `(ctrl+shift+m)`（原来是 `(shift+tab)`）。
4. 按 `shift+tab`：不再触发模式切换（键已被改走）。
5. 把配置改为 `"shortcuts": { "cycleProfile": null }` → `/reload` →
   `alt+i` 应失效（profile 循环禁用）。
6. 删掉整个 `shortcuts` 段 → `/reload` → `shift+tab` 恢复循环模式。
   此步依赖前置条件：`C:\Users\wpw\.pi\agent\keybindings.json` 中已有
   `{"app.thinking.cycle": []}`（本机已配置）。若没有该条目，`shift+tab`
   会被 pi 内置 thinking 循环占用、插件注册再次被丢弃。
7. 恢复正常使用：直接 `pi` 启动（不带 `-ne -e`）→ 加载的是 npm 2.6.3 发布版。

## 5. 踩坑记录：`ctrl+m` 是 Enter 的别名（已被插件防护）

实测确认的坑：把 `cycleMode` 配置为 `ctrl+m` 后，**Enter 和 ctrl+m 都会切换权限模式**，
消息永远无法提交，pi 完全不可用。逐层根因：

1. **终端层**：`ctrl+m` 与 Enter 发送的是同一个字节 `\r`（回车符 CR, 0x0D）——
   这是终端的物理限制，任何程序都无法区分。
2. **pi 匹配器层**：pi（0.83/0.84.4 实测）的 `matchesKey` 对 Ctrl+字母的 legacy
   分支 `rawCtrl && data === rawCtrl` **没有** Kitty 协议门控——`rawCtrlChar("m")`
   就是 `\r`，所以 `matchesKey("\r", "ctrl+m")` 恒为 true。pi 请求的 Kitty flags
   为 7（不含 flag 8），Enter 在任何终端都仍发 `\r`。
3. **分发层**：扩展快捷键在 `custom-editor.handleInput` 中**最先**检查，
   优先于消息提交——所以 Enter 永远先命中 `ctrl+m` 快捷键。

排查时的干扰项：`{"cycleMode": "ctrl+m"}` 与三键全写的配置注册出来的快捷键集合
完全相同（未写的键回落默认值），配置内容不构成行为差异；"第二次测试正常"实际是
当时没有专门验证 Enter 提交。**结论：`ctrl+m` 在此 pi 版本上无法作为安全快捷键，
与终端无关。**

防护方案（已实现）：`config.ts` 的 `isUnsafeShortcutKey()` 在注册前拒绝以下键，
只输出警告、不注册，绝不让坏配置把编辑器弄瘫：

- 终端控制字符别名：`ctrl+m`（Enter）、`ctrl+i`（Tab）、`ctrl+j`（LF）、
  `ctrl+h`（Backspace）、`ctrl+[`（Escape）
- 裸编辑器键：`tab`、`backspace`、`space`（pi 不将其列入扩展保留名单）
- 裸字符 / `shift+` 单个可打印字符（会劫持正常输入）

警告输出两路：`console.warn`（stderr）+ 会话启动时 `ctx.ui.notify`（warning，
每次加载只提示一次）。页脚提示跟随**实际注册**的键（被拒或禁用时不显示）。
安全键示例：`ctrl+shift+m`、`alt+m`、`f2`。

## 6. 自动化测试

```bash
cd D:\ubuntu_docs\Codes\To-Study\pi-permission-modes
npm install        # 首次需要
npm test
```

- 本次新增 **12 个测试全部通过**：
  - `config.test.ts`（新建，7 个）：默认回退、逐键覆盖、`null`/空白禁用、
    大小写与空白归一化、未知字段忽略；
  - `index.test.ts` 追加 describe `configurable shortcuts`（5 个）：默认注册、
    自定义键替换默认键、自定义键真正循环模式（ask → plan）、`null` 禁用、
    小写归一化。
- 全量结果（Windows 本机）：**357 passed / 24 failed（381 total）**。
  这 24 个失败为 **master 基线上既有的 Windows 环境问题**（model-profiles
  测试用 `/tmp` 路径、utils 测试断言 Unix 风格路径分隔符），已用
  `git stash` 基线对照确认与本次改动无关（基线同样 24 failed）。

## 7. 已知边界

- 插件内不做按键冲突检测——无法感知 pi 解析后的键位表，保持扩展边界；
  与 pi 内置键冲突时仍由 pi 的保留名单机制裁决（启动警告可见）。
- `cycleMode` 配置的键如果恰好也是 pi 其他保留键（如 `escape`、`ctrl+d`），
  同样会被跳过，选择空闲组合键即可。
