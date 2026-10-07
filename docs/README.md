# docs

permission-modes 插件的文档目录：产品需求、模式提示词、任务追踪、实现计划与测试指南。

## 文档索引


| 文件                                                                     | 说明                                |
| ---------------------------------------------------------------------- | --------------------------------- |
| [PRD.md](PRD.md)                                                       | 产品需求文档（目标、用户、功能、成功指标）             |
| [prompts/](prompts/)                                                   | 各权限模式的系统提示词上下文（ask / plan / auto） |
| [suggestions.md](suggestions.md)                                       | 未来版本的功能点子                         |
| [TODO.md](TODO.md)                                                     | 任务追踪清单（可勾选，实现计划从子项链接进入）           |
| [plan/](plan/)                                                         | 功能实现计划（带时间戳前缀，审阅通过后才编码）           |
| [testing-configurable-shortcuts.md](testing-configurable-shortcuts.md) | 可配置快捷键功能的测试指南                     |


### 注意：

[PRD.md](PRD.md)、[prompts/](prompts/)  、[suggestions.md](suggestions.md)是fork之前原作者的文档，要求只做参考、只读不修改。后续需要类似的文档，直接新建其他文档

## 测试指南简介

[testing-configurable-shortcuts.md](testing-configurable-shortcuts.md)
是针对 `feat/configurable-shortcuts` 分支（可配置快捷键功能）的完整测试说明，
基于一次真实的本地验证过程整理，覆盖：

- **背景**：`shift+tab` 与 pi 内置 `app.thinking.cycle` 的冲突根因，
以及为什么 `keybindings.json` 改不了扩展快捷键、正确用法是什么；
- **功能用法**：`~/.pi/agent/permission-modes.json` 的 `shortcuts` 配置段——
三个字段（`cycleMode` / `cycleThinking` / `cycleProfile`）、默认值、
`null` 禁用、`/reload` 生效；
- **临时加载方式**：不卸载 npm 发布版，用 `pi -ne -e <仓库>/index.ts`
会话级切换到本地代码库版本（含 alias 写法与副作用说明）；
- **验证清单**：从启动警告消失、新键循环模式到禁用/恢复默认的 7 步逐项验证；
- **自动化测试**：新增 12 个测试的构成，以及 Windows 基线既有失败的对照说明。