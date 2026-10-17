# 实现计划：彻底移除 model-profile 功能（切模式不再切换模型与思考强度）

> 状态：**待审阅**（审阅通过后才会开始编码实现）
> 日期：2026-10-07
> 计划分支：`feat/remove-model-profiles`（自 `feat/configurable-shortcuts` 最新提交 `d038ffc` 切出）
> 对应 TODO：[docs/TODO.md](../TODO.md)

---

## 1. 背景与根因（已核实）

用户报告：用 `alt+x` 或 `/mode` 切换权限模式时，模型被切到 `profile:default · MiniMax-M3 • medium`，
模型与思考强度均被擅自改动。定位到四个叠加缺陷（安装版与当前分支代码一致，commit `c8fddc3`）：

1. **每次切模式都尝试切模型**：所有模式切换入口（`alt+x` / `/mode` / `/ask` …）最终走
   `setMode()`，其中无条件调用 `await applyProfileModelForMode(mode, ctx)`（index.ts:655）。
2. **"懒激活"把文件存在当成 opt-in**（index.ts:677-687）：内存 `activeProfile === undefined`
   时，只要 `~/.pi/agent/model-profiles.json` 存在且非空，首次切模式即自动激活
   `cfg.active || "default"`——即使用户从未显式启用。
3. **扩展自己制造 opt-in**：`session_start` 调用 `ensureModelProfilesConfig()`（index.ts:2031）
   自动创建带 `"active": "default"` 的配置文件，`/reload` 时用户删掉还会重建。
   违反 AGENTS.md 边界约定"pi.setModel() 仅在用户显式 opt-in 时调用"。
4. **思考强度强制改为 medium**：`pi.setModel()` 成功后 `resolveEffortForMode()` 回落到
   `DEFAULT_PROFILE_EFFORT = "medium"`（profiles.ts），即使 profile 只配了模型也会
   `pi.setThinkingLevel("medium")` 覆盖当前 thinking level。

另外 `persistState()` 会把 `activeProfile` 写入会话并在下次启动恢复（本机会话文件中实际存有
`"activeProfile":"default"`），使脏状态跨会话复活。

## 2. 决策（用户已拍板）

**彻底移除 model-profile 功能**，理由：

1. "切权限模式时换模型/思考强度"基本不会被用到；
2. pi 原生 `/model` 已覆盖换模型需求，profile 冗余；
3. 会话内反复切模型降低 prompt 缓存命中率。

附带：随 profile 走的每模式 skill 过滤一并移除（回落 allow-all）；
未来若做每模式 tool/skill 过滤，配置改住 `~/.pi/agent/permission-modes.json`。

## 3. 目标行为

- 切换权限模式（任意入口）**绝不**调用 `pi.setModel()` / `pi.setThinkingLevel()`，
  模型与思考强度完全保持用户当前状态；
- footer 不再出现 `profile:xxx · ` 前缀；
- skills / tools 恒为 allow-all（计划模式原有的硬编码工具限制不变）。

## 4. 改动清单

### 4.1 `index.ts` — 删除全部 profile 机制（约 20 处）

- 删状态变量 `activeProfile`、`modelProfileConfig`（~L209-215）
- `setMode()`：删 `await applyProfileModelForMode(mode, ctx)`（~L655）
- 删函数：`applyProfileModelForMode()`（~L668-740）、`setActiveProfile()`（~L743-760）、
  `cycleProfile()`（~L1484-1505）
- `persistState()`：删 `activeProfile` 字段（~L240）
- footer：删 `profile:` 前缀拼接（~L795-796）
- 删 `/model-profile` 命令注册（~L1190-1260）
- 删 `PROFILE_EFFORT_LEVELS` 常量（~L136）及所有 `./profiles.js` 导入（~L121-129）
- 快捷键：`ShortcutField` 删 `"cycleProfile"`（~L1405）；删
  `registerConfiguredShortcut("cycleProfile", …)` 块（~L1506-1512）
- 删 `pi.registerFlag("model-profile", …)`（~L1521）
- `session_start`：删 `ensureModelProfilesConfig()` 调用（~L2031）、`--model-profile`
  flag 处理（~L2042-2056）、`activeProfile` 会话恢复（~L2077-2078）、结尾
  `if (activeProfile) await applyProfileModelForMode(...)`（~L2124-2128）
- `before_agent_start`：删 `resolveSkillFilter` / `filterSkillsFromPrompt` 调用（~L1826）

### 4.2 `config.ts` — shortcuts 配置瘦身

`ShortcutConfig` 类型、`DEFAULT_SHORTCUTS`、`resolveShortcuts()` 中删 `cycleProfile`
（用户配置里残留的 `cycleProfile` 键自然忽略，无需迁移）。

### 4.3 删除文件

- `profiles.ts`、`profiles.test.ts`

### 4.4 测试

- `index.test.ts`：删/改所有 profile 相关用例（懒激活、ensure 配置、effort 默认值、
  `/model-profile`、`--model-profile`、footer 前缀、会话恢复 activeProfile、skill 过滤）
- `config.test.ts`：删 `cycleProfile` 用例
- 全量 `npm test` 必须绿

### 4.5 文档与版本

- `README.md`：删 Model Profiles 章节、命令/快捷键/flag 表相关行、目录结构中 profiles.ts、
  "opt-in setModel" 段落
- `docs/PRD.md`：**只读不改**（fork 前原作者文档，按 docs/README.md 规定仅参考）
- `AGENTS.md`：更新 Summary / Structure / Commands / Boundaries / Known Issues / Current Focus
- `CHANGELOG.md`：`[Unreleased]`（可配置快捷键两条）并入新 `## [3.0.0]`，写明移除内容与理由
- `package.json`：`version` → `3.0.0`（移除公开功能 + shortcuts schema 变更，semver major）

## 5. 验证

1. `npm test` 全绿；
2. 本地冒烟：`pi -ne -e <仓库>/index.ts` 加载本地版本，`alt+x` 与 `/mode` 反复切换四种模式，
   确认模型/思考强度不变、footer 无 `profile:` 前缀、无 setModel/setThinkingLevel 副作用；
3. 确认不再读取 `~/.pi/agent/model-profiles.json`（文件惰性化）。

## 6. 清理与交付

- 删除本机残留脏文件 `~/.pi/agent/model-profiles.json`（修复后已不被读取）；
  `~/.pi/agent/permission-modes.json` 只配了 `cycleMode: "alt+x"`，无需改动；
- 提交到 `feat/remove-model-profiles` 分支，推送 `fork` 远端
  （Sticky-Finger/pi-permission-modes-custom-hotkey —— 用户全局安装所跟踪的源）与 `origin`；
- 用户侧：更新 git 安装的扩展并重启 pi 后生效。

## 7. Git 工作流

1. ✅ 已从 `feat/configurable-shortcuts` 最新提交 `d038ffc` 切出 `feat/remove-model-profiles`；
2. 审阅通过后按上述清单编码，完成后更新 TODO.md 勾选状态并提交。
