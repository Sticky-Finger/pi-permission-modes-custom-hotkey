# 快捷键冲突检测区分修饰键顺序（同一物理键可被注册两次）

> 状态：**已知，暂不修复**
> 记录日期：2026-11-09
> 关联：可配置快捷键（[20260829-2239-configurable-shortcuts.md](../plan/20260829-2239-configurable-shortcuts.md)）、反向模式循环（[20261109-1301-reverse-mode-cycle.md](../plan/20261109-1301-reverse-mode-cycle.md)）

## 问题

插件判断「两个快捷键是不是同一个键」用的是**原始字符串比较**，只做了 `trim + 小写`：

- `config.ts:58` `normalizeShortcutKey()`：`key.trim().toLowerCase()`，不重排修饰键；
- `index.ts:1452-1454` 冲突检测：`otherKey === key` 直接比字符串。

而 pi 的匹配器是**修饰键顺序无关**的：`node_modules/@earendil-works/pi-tui/dist/keys.js:603` 的 `parseKeyId()` 按 `+` 切开后，只用 `parts.includes("ctrl" / "alt" / "shift" / "super")` 判定修饰键、取最后一段当主键。因此 `ctrl+alt+x` 与 `alt+ctrl+x` 在 pi 眼里是同一个键，在插件眼里却是两个不同的键。

实测（`@earendil-works/pi-tui` 的 `matchesKey`）：

```
modifyOtherKeys ESC[27;7;120~  → ctrl+alt+x: true, alt+ctrl+x: true, alt+x: false
kitty CSI-u      ESC[120;7u   → ctrl+alt+x: true, alt+ctrl+x: true
```

## 影响

- 配置 `cycleMode: "ctrl+alt+x"` + `cycleModeReverse: "alt+ctrl+x"`（或反之）时，两者都会被注册——「not registered (same as cycleMode)」的警告**不会触发**，用户以为两个键都在，实际同一次按键会同时命中两个 handler。
- pi 只派发其中一个（扩展快捷键在编辑器里按注册顺序最先匹配），于是反向键可能静默盖掉正向键，或两个 handler 都跑（一次按键切两次模式）。
- 同一物理键存在多种合法写法，`/mode-hotkeys` 表格与页脚提示会**按用户写的顺序原样回显**（`index.ts:1363` `formatShortcutKey()` 不重排修饰键），`Ctrl+Alt+X` 与 `Alt+Ctrl+X` 显示不一致，容易让用户误以为是两个不同的键。
- （`isUnsafeShortcutKey()` 不受影响：它的拒绝列表里全是 ≤ 1 个修饰键的键，无顺序可换。）

## 复现

1. `~/.pi/agent/permission-modes.json` 写入：

   ```json
   { "shortcuts": { "cycleMode": "ctrl+alt+x", "cycleModeReverse": "alt+ctrl+x" } }
   ```

2. `/reload`（或重启 pi）；
3. `/mode-hotkeys`：两行都显示 `active`，没有冲突提示；
4. 按一次 <kbd>Ctrl+Alt+X</kbd>：模式切换行为与预期不符（正向/反向只有一个生效，或一次切两格）。

当前用户本机配置 `"cycleModeReverse": "alt+ctrl+x"` 与 `"cycleMode": "alt+x"` 不冲突，只是显示顺序为 `Alt+Ctrl+X`，功能正常。

## 修复方向（未排期）

- 在注册前把键规范化为固定顺序（如 `ctrl → alt → shift → super → 主键`），冲突检测、`isUnsafeShortcutKey()` 判定与显示统一使用规范化结果；
- 顺带统一 `/mode-hotkeys` 与页脚的显示顺序，避免同义写法显示不一致；
- 补测试：两种顺序写法应被判为同一键（冲突告警触发、只注册一个）。

## 重启条件

用户反馈「快捷键配了不生效 / 一次按键切两格」时，或做快捷键相关清理版本时。
