# 模式循环顺序调整（ask 提到队首，排序依据改为「自主度」）

> 状态：**已批准**（2026-11-09 用户确认直接实现）
> 日期：2026-11-09
> 计划分支：`refactor/mode-cycle-order`（自 `fix/wrap-around-selector` 最新提交 `b891232` 切出）

## 0. 一页看懂

**做什么**：把模式循环顺序由「只读在最前」改为「Ask 在最前、只读紧随其后」，并把排序依据从「权限从紧到松」换成「无人干预下的自主度」。

| 面 | 改前 | 改后 |
| --- | --- | --- |
| Shift+Tab 循环 | `readonly → ask → plan → auto → bypass` | `ask → readonly → plan → auto → bypass` |
| 默认位置（新会话 ask） | 队首第 2 项，首跳即 `plan` | 队首第 1 项，首跳即 `readonly` |
| `/mode` 选择器首行 | Read Only | Ask |
| `/mode` 帮助文案 | `readonly \| ask \| ...` | `ask \| readonly \| ...` |
| `bypass` 的后继 | `readonly` | `ask` |
| 门控行为 | — | **零变化** |

**关键铁律**：

1. 只改**顺序与说明文字**，不碰任何放行/拦截判定、风险分级、只读白名单、classifier。
2. 源码改动后必须 `npm test` 全绿 → `npm run build` 重建并提交 `dist/index.js`（`dist.test.ts` 逐字节新鲜度门禁；git 安装不跑构建）。
3. `AGENTS.md` / `CLAUDE.md` 不动（用户未要求）。
4. 不提交、不推送、不发版（§7 需用户明确同意）。

## 1. 背景（已核实）

1. **现状顺序**：循环顺序常量当前为 `readonly → ask → plan → auto → bypass`（`index.ts:141`）。
2. **该常量只被三处消费**：循环切换（`index.ts:714`）、`/mode` 选择器与帮助文案（`index.ts:951`、`index.ts:967`）、按模式批量注册命令的循环（`index.ts:921`）。**全部是 UI/注册顺序**，没有一处门控依赖下标或首位。
3. **默认模式是 `ask`**（`index.ts:160`），且 `--permission-mode default` 也映射到 `ask`（`index.ts:1963`）。因此「队首」与「默认模式」目前错位一格，这正是用户观感上「只读在最后」的来源。
4. **现有 D1 决策依据是「权限从紧到松」**（`docs/plan/20261107-0847-readonly-mode.md:161`），当时把只读放队首。
5. **但按权限大小排序，只读其实更小**：只读是硬天花板，配置的 `allow` 规则都不能放宽（`README.md:166`）；`ask` 在用户批准后可写任意文件。用户采用的新依据是「无人干预下的自主度 / 单次运行时长 / token 消耗」——ask 每步都要停下等批准，只读一次跑到底，故只读应排在 ask **之后**（自主度更高）。两个依据都自洽，但**必须二选一并写进文档**，否则顺序会被后人按旧依据改回去。
6. **唯一受影响的边界跳转**：`bypass` 的下一个模式从 `readonly` 变成 `ask`（D1 原文曾以此作为反对队尾方案的理由）。
7. **一处测试会失效**：`index.test.ts:1947` 的用例名与断言写死了「ask 一跳即 plan」（`index.test.ts:1962`）。
8. 继承相关集合（`mode-inherit.ts:16`）只是成员校验，顺序无语义，无需改动。

## 2. 需求目标（验收标准）

- **A1** 新会话（默认 `ask`）按下一次循环键后进入 **Read Only**，再按一次进入 Plan，再 Auto，再 Bypass，再回到 Ask；5 跳回到起点。
- **A2** 循环顺序在三个面上**完全一致**：循环键、`/mode` 选择器列表、`/mode` 帮助文案，均为 `ask → readonly → plan → auto → bypass`。
- **A3** `/mode` 选择器首行为 **Ask**，第二行为 **Read Only**；选择任一项仍能正确切到该模式（选择→模式的映射不因顺序调整而错位）。
- **A4** 门控行为零变化：同一模式下的允许/拦截结果与改动前逐条一致（既有回归测试全绿，无行为断言被削弱）。
- **A5** 每个模式的独立入口不受影响：`/ask`、`/readonly`、`/plan`、`/auto`、`/bypass`、`--permission-mode <name>`、`default` 别名、会话恢复、子代理继承全部照旧可用。
- **A6** 默认启动模式仍是 **ask**（本次不改变默认模式，只改变顺序）。
- **A7** 文档中记录的排序依据统一为「无人干预下的自主度」，并明确标注只读在**权限**上是更小的（避免顺序被误读为「越靠后权限越大」）。
- **A8** 产物更新：`dist/index.js` 与源码同一次提交内一致，字节级新鲜度门禁通过，体积在预算内。

## 3. 验证

1. **新增测试（顺序可验证，而非靠肉眼）**：
   - 循环顺序精确序列：从默认 `ask` 起连续触发 5 次循环键，断言序列为 `ask → readonly → plan → auto → bypass → ask`。
   - `/mode` 选择器选项数组顺序与循环顺序一致（首行 Ask、第二行 Read Only）。
   - `/mode` 帮助文案中模式名的排列顺序与循环顺序一致。
   - `bypass` 的后继为 `ask`（钉住 A1 中被改变的边界跳转）。
2. **修改既有测试**：`index.test.ts:1947` 的「自定义 cycleMode 键循环（ask → plan）」改为断言进入 Read Only，并同步用例名。
3. **回归**：`npm test` 全绿；与基线对照，除上述被有意修改的用例外不得新增失败。
4. **构建**：`npm run build` 成功，三道门禁（externals / 体积预算 / 产物新鲜度）全过；`dist.test.ts` 通过。
5. **实机验收（用户侧）**：`/reload` 后在 pi 中按循环键 5 次核对顺序、打开 `/mode` 核对首两行、切换后 footer 与状态正确、进入 readonly 后 edit/write 仍被拒。

## 4. 文档同步

| 文档 | 需要改什么 |
| --- | --- |
| `README.md` | Modes 表行序（Ask 在前、只读在后）、`**Cycle (Shift+Tab):**` 一行、默认模式说明处补一句排序依据 |
| `docs/prompts/readonly-mode-prompts.md` | `Cycle position:` 一行 |
| `CHANGELOG.md` | `[Unreleased]` → `Changed`：记录顺序调整 + 排序依据变更 + `bypass` 后继变化 |
| `docs/TODO.md` | 新增条目（`## 进行中`，按计划时间排在本批最后）→ 完成后移入 `## 已完成` 并补测试数与产物字节 |
| `docs/plan/20261107-0847-readonly-mode.md` | **不改历史结论**，在实现记录后追加一条变更记录，指向本计划，说明 D1 的排序依据被替换（保留可追溯性） |
| `AGENTS.md` / `CLAUDE.md` | 不动（用户未要求；其 invariants 中的旧描述留待用户决定） |

## 5. 明确不做的事

- 不改任何门控/分级逻辑：只读白名单、classifier、风险黑名单、allow/deny/ask 规则求值顺序、`bypass` 的 outside-cwd 快照与 undo。
- 不改默认启动模式（仍为 `ask`），不改 `--permission-mode` 取值集合，不改 `PERMISSION_MODES_INHERITED_MODE` 的可继承集合。
- 不改模式图标/配色/标签文案（`◐` / `●` / `⏸` / `▶` / `⚡` 与 role 保持原样）。
- 不重构循环/选择器实现，不引入配置项（如自定义排序），不新增依赖。
- 不提交、不推送、不打 tag、不发 npm（等用户明确同意）。

## 6. 风险与备注

1. **依据冲突（主要风险）**：D1 的「权限从紧到松」与新依据「自主度」互斥。若只改顺序不改文档依据，后人会按旧依据把只读挪回队首。→ 由 A7 强制要求文档写明依据。
2. **语义误读风险**：只读在**权限**上是更小的（硬天花板，`allow` 规则不可放宽），排在 ask 之后容易被读成「只读权限更大」。→ README 需一句话区分「权限大小」与「自主度」两个轴。
3. **边界跳转变化**：`bypass → ask` 取代 `bypass → readonly`。从最松直接回到会频繁打断的 ask，体感变化明显；这是本次改动的既定代价，需在 CHANGELOG 写明。
4. **产物陈旧**：只改源码不重建 `dist/index.js` 会让 git 安装的用户看到旧顺序，`dist.test.ts` 会拦住——必须在同一次提交内包含产物。
5. **测试脆弱性**：顺序断言写成硬编码期望序列，后续再加模式需同步改；本次仍选择硬编码（可精确钉住 A1），并在用例注释中说明来源。
6. **分支类型**：行为不变、仅顺序与文案，故取 `refactor/mode-cycle-order`。

## 7. 实现记录

- **落地**：循环顺序常量改为 `ask → readonly → plan → auto → bypass`（`index.ts:141`，附排序依据注释）；`/mode` 帮助文案同步；`/mode` 选择器、`/readonly` 等模式命令与 `--permission-mode` 均无需改动（顺序全部派生自同一常量）。
- **测试**：新增 `index.test.ts` 的 `mode cycle order` 段共 6 例（5 跳精确序列、`bypass → ask`、选择器顺序 `Ask/Read Only/Plan/Auto/Bypass`、选择映射不错位、`/mode` 描述文案、默认模式仍为 ask）；修改既有 1 例（自定义 cycleMode 键首跳改为 `readonly`）。为断言描述文案，fake pi 的 `registerCommand` 新增 `commandDescriptions` 记录（仅测试基建）。
- **回归**：`npm test` 402 例全绿（较上一版 396 例 +6），无行为断言被削弱。
- **产物**：`dist/index.js` 89,351 B raw / 30,989 B gzip（预算 92,160 B / 32,768 B），三道门禁全过。
- **偏离**：无。计划 §4 的文档同步全部完成（README / `docs/prompts/readonly-mode-prompts.md` / CHANGELOG `[Unreleased]` / TODO / 旧计划 §9 变更记录）。
- **未做**：`AGENTS.md` / `CLAUDE.md` 未改（其 invariants 仍写「四模式 ask → plan → auto → bypass」，属上游遗留描述，等用户决定）；未提交、未推送。
