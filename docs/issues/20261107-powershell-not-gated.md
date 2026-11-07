# powershell 工具未适配权限门禁

> 状态：**已知，暂不修复**
> 记录日期：2026-11-07
> 关联：只读模式需求（[20261107-0847-readonly-mode.md](../plan/20261107-0847-readonly-mode.md)）

## 问题

本插件没有对 pi 的 `powershell` 工具做任何适配。门禁只识别 `edit` / `write` / `bash` 三类工具，`powershell` 进不了任何 shell 判定分支。

## 影响

在 Windows 上启用 `powershell`（settings 的 `defaultTools` 显式加入）时：

- **plan 模式**：落到门禁末尾的默认放行，`Set-Content` / `Remove-Item` 等写命令可直接执行——「只读」不成立。
- **ask 模式**：同样默认放行，不弹窗、不拦截。
- **auto 模式**：被当作「未知工具」送进 tier-3，有 UI 会弹窗、无 UI fail-closed，但拿不到命令内容做风险判断，只能拦、不能审。
- **权限规则**：规则映射表里没有 powershell，`PowerShell(...)` 规则永远匹配不上，无法用规则兜底。

macOS / Linux 默认不暴露该工具（默认激活集只有 read / bash / edit / write），不受影响。

## 复现

1. Windows，settings 设 `"defaultTools": ["read", "powershell", "edit", "write"]`；
2. 切到 plan 模式；
3. 让模型执行 `Set-Content test.txt hi` —— 写入成功，无任何拦截。

## 修复方向（未排期）

- 为 powershell 提供只读命令判定，或先 fail-closed；
- 把 powershell 映射进 allow / deny / ask 规则体系；
- 工具分类与只读模式共用同一套。

## 重启条件

Windows 用户反馈 / 发布前安全审查 / 正式支持 powershell 时。
