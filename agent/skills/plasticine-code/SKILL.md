---
name: plasticine-code
description: 写、改、审 Plasticine 的代码时使用：代码规矩的正本。目录按「内部业务 / 外部技术」分、模块只经 index.ts 往来；行宽 ≤ 120、一行一个语句、一文件一职责（源码 500 行软上限）、先写测试、接口 schema 两端共享、不吞错误；能自动检查的都在 npm run check 里。Claude、Codex 等所有 Agent 同样遵守；不新增任何授权。
---

# Plasticine 代码规矩

**这份是代码规矩的正本**，不管哪个 Agent 来写代码都照它做；私有仓库（Cyber Hunter 中继和运维）的代码也照它做。
聊天记录和讨论只是过程，定下来的都写在这里。新定的规矩当场写进这里，能自动检查的同时加一条检查进 `npm run check`
（已有的检查见文末「自动检查」）。「界面长什么样」看 plasticine-visual（正本是它的 `references/page-spec.md`）。
两份 Skill 一起用，谁都不新增授权。

先读相关模块的现有代码、schema 和测试，再动手。「改什么去哪」看 [structure.md](references/structure.md)，
测试怎么写看 [testing.md](references/testing.md)，提交前自查看 [review-checklist.md](references/review-checklist.md)。

## 三条标准（目录和文件怎么分，拿不准时按这三条判断）

1. **很快知道该改哪里**：从目录看得出业务规则、用例、存储各在哪。
2. **改的时候少读上下文**：一件事的代码放在一起，不用翻五个目录才看懂。
3. **连带修改少**：改一个业务不牵动别的业务。

做法：先分**内部业务**和**外部技术**。外部技术是数据库（`state/`）、接口（`app/`）、外部服务和设备（`cloud-tools/`、
`devices/`、`kernel/`）；内部业务每个一个包，用同一个模型的用例放同一个包（抖音收藏、视频转写、视频报告都在 `video/`；
记忆的文档、今天的记录、做梦、整理都在 `memory/`）。一个完整功能通常要同时改三处：业务包里的规则、`state/` 里的存取、
`app/` 里的接口——位置固定，好找。

不照搬分层模板：

- **不做依赖倒置**：存储只有 SQLite 一种，业务包直接用 `state/` 的出口，不为它另定义接口；测试拿临时 SQLite 跑真实现。
- **业务包里不再分领域层、应用层**：包大了按职责分子目录（`memory/docs`、`memory/dream`），不按层分。
- **不为还没有的需求写代码**：没有第二种实现不加接口，没有第二处用到不抽公共模块，没人要的功能不做。
- **结构和规范上的整理不算过度开发**：发现放错地方、重复、和这份规范对不上的，当场收拾干净，和功能改动分开提交。

## 底线（违反任何一条 `npm run check` 不过）

1. **行宽 ≤ 120，一行一个语句**。`{ a(); b(); }` 这种一行写完的要展开；CSS 一行一条声明，花括号不和声明挤一行。
   只有一个语句的短块、只有一条声明的短规则可以留在一行（`if (x) { return; }`、`.a { color: red; }`）。
2. **三元最多套两层**（`a ? b : c ? d : e`）。再多就改成 `if`、查表或拆成小函数。
3. **不吞错误**：空的 `catch {}` 不许出现。`catch` 里要么处理、要么带上下文抛出、要么写日志并让状态变成「结果待核实」。
4. **模块之间只经 `index.ts` 往来**（`agent/src/`）：不引别的模块的内部文件，模块里的文件不绕自己的 `index.ts`；
   `agent/src/` 根上不放散文件；每个模块都有 `index.ts`，开头几行注释写这个模块管什么；文件顶层不读别的模块的常量。
5. **界面分层只能往下引**（`client/src/`）：`api/` 不引别的层，`state/` 只引 `api/`，`primitives/` 不引 `views/`；
   页面和零件里不直接 `fetch` 本体的接口；测试文件不放在 `src/` 里。
6. **类型**：TypeScript 开到最严（`strict`、`noUncheckedIndexedAccess`、`exactOptionalPropertyTypes`、
   `noUnusedLocals`——没用到的导入和变量删掉）；不写 `any`；只用可擦除语法（不用 `enum`、`namespace`、参数属性），
   相对导入写 `.ts` 后缀，类型导入用 `import type`。
7. **测试不许无条件跳过**：没有 `.skip`、`.only`、`.todo`。暂时修不了的，删掉这条测试并在提交里说明，不留跳过。
   只在某种系统、装了某个工具才能跑的，写成带原因的条件跳过（`{ skip: 有工具 ? false : '这台机器没有装 ffmpeg' }`）——
   报告里看得见它没跑，比假装通过老实。
8. **文件名说它是什么**：不用里程碑、批次当名字（`m5b-…`、`第13批-…`）。
9. **一份代码只有一处**：同一段逻辑不放两份；私有仓库从公开仓库拷来的文件必须和原件一字不差（私有仓库的检查守着）。

**一个文件一个职责**：源码超过 500 行（CSS 一行一条声明、本来就长，上限 800 行）先看它是不是干了不止一件事——是就按
职责拆。确认只干一件事、拆开反而要来回翻的，登记在 `scripts/lint-rules.ts` 的 `LONG_FILES_ALLOWED` 里并写明原因
（lint 只提醒）；不在名单里的超过上限不过。测试文件不限长度。

## 代码长什么样

- 标识符英文、界面文案中文、注释中文。注释说「为什么」不说「是什么」；每个文件开头一两行写这个文件管什么。
  文件名 kebab-case，类型 PascalCase，函数 camelCase，常量 UPPER_SNAKE。
- 注释自己把原因说清楚，可以带日期（「11-15：只有一种存储，不加接口」），**新写的注释不写「第 N 条」「第 N 批」这类
  只有维护者的私有记录里查得到的编号**，也不写真人的名字（写「用户」「维护者」）。旧注释里的编号指的是维护者自己的
  项目文档，不用批量改，改到那一段时顺手改成原因。
- 用户看得到的错误文案是中文的一句话加下一步（「连接超时，尚未取得服务回执。稍后在对话里看结果。」），不是堆栈。
- 没有魔法数：时限、上限、尺寸进常量并写来由。
- 外部输入（请求体、模型输出、文件内容）进来先过 schema 校验再用。
- 时间一律 ISO 字符串存、按用户时区显示；金额用整数分；id 用稳定字符串，不用数组下标当身份。
- 异步：每个长任务可取消（AbortSignal）；定时器和订阅有对应的清理；进程退出前保存接续点。
- 日志只经 `util/` 的日志函数，源码里不直接用 `console`（`agent/tests/util/log.test.ts` 守着）。
- 不引新依赖，除非写明替代方案为什么不行（先问维护者）；不引远程字体、不引 UI 组件库、不引 Tailwind
  （前端是 React + Vite + 普通 CSS + 令牌变量，TipTap 只给笔记）。
- 模型接入用上游 pi：内核依赖 `@earendil-works/pi-ai` 和 `@earendil-works/pi-agent-core`，版本号写死、不 fork、不改它的
  源码，要的行为在 `kernel/`、`lines/` 外面包；升级 pi 是一次单独的改动，跑全测。所有模型调用都经内核：主对话和后台活
  走线（`lines/`），翻译、笔记助手、记忆整理这类旁路调用走 `kernel/` 的 `TextModels`，不另写 provider、不另存模型设置。

## 接口与数据类型

- 接口的 schema、常量和类型只有一份，在 `agent/shared/`（typebox）：agent 的接口、工具参数、事件都在那里定义，client 只从
  `client/src/api/shared.ts` 这一个入口导入，不手写一份接口类型。
- `agent/protocol/` 和 `agent/shared/` 里标了 `SPDX-License-Identifier: Apache-2.0` 的文件是网络协议，只能引别的
  Apache-2.0 文件、node 内置和 npm 包；新的线上格式放这边。
- 一个 `app/` 资源文件只做：路由、参数校验、调业务包的接口、组装响应。不含业务判断、不碰库。
- 界面取数只经 `client/src/api/`：组件里不直接 `fetch` 本体的接口。

## 数据与状态

- 只有 `state/` 写 SQLite：一类对象一个文件、一张表、一个 schema；只做存取，不含业务判断。别的模块拿到的是对象和事件，
  不拿 db 句柄。
- 迁移只加不改旧迁移，迁移号在 `state/migrations/` 里顺延；要删表、删列时新开一条 `destructive` 迁移，并在它的 `changes` 里写明哪些表的行数会变（副本演练时别的表行数一变就不过）。新迁移先问维护者，
  上线前在线上库的副本上演练。产品里删用户数据只记 `deleted_at` / `removed_at`；例外是「最近删除」的清空和永久删除。
- 新表要在 `state/migration-tables.ts` 登记归哪一类（他的东西 / 这台的记录 / 密钥和设置 / 只属于这台 / 索引）：
  数据迁移（11-16）按这个决定导不导出、只要数据的带不带、合并时并不并。状态目录里新的东西同样要在
  `system/migration/layout.ts` 的名单里写清楚带不带。
- 用户原话、系统处理、推测、现实结果分开记，各留真实来源；系统不能冒充用户确认，不替用户补写答案。
- 来源权重 `w` 只表示来源，不当真值或权限判断；唯一的用法是上下文超预算时的截断顺序。
- 每个有副作用的动作带稳定的动作标识，重放不重复执行（`system/` 的 external-once 和 receipts）。
- 线的状态只经 `LineKernel` 改；非法的转换抛错不静默。
- 界面状态：服务端对象的副本放在各自的 store（`state/resource-store.ts`、`state/live-query.ts` 这一套：先画手里的，
  事件按版本就地换，回执不确定算「结果待核实」）；`client/src/state/` 只放客户端自己的状态（草稿、滚动位置、界面偏好），
  不另存一份业务规则。

## 组件复用（界面）

- 先找现成的再写新的：通用零件在 `primitives/`（搜索框、占位、转圈、看图层、提示条、Sheet……）和 `shell/`
  （图标按钮、菜单、浮层、页头、第二栏）；多选在 `views/bulk/`。清单和用法在 plasticine-visual 的 `page-spec.md`。
- 一个零件一个目录：`index.tsx`、`styles.css`，测试在 `client/tests/` 的同名位置。
- 样式只用令牌（`client/src/tokens.css`），不写死颜色、阴影、字号、圆角、间距、层级、动效时长。

## 安全

- 密码、密钥、令牌不进代码、日志、测试、提交；只从服务器上的环境或密钥文件读。
- 公开仓库不放任何真人资料；测试和假接口只用虚构的人和事。推送前跑 `node scripts/scan-tests.ts`。
- 删除按实际用户授权执行并留回执。安全检查或分类器拦下的操作不绕过，停下来告诉用户。
- 截图、命令输出里看到的卡号、邮箱不复述；含聊天或记忆内容的临时文件用完覆盖。

## 每次改动的流程

1. 读现状：相关模块的 `index.ts`、schema、已有测试；写下这次改动的范围和不动的东西。
2. 先写测试：失败的测试先存在。
3. 实现到测试过；跑 `npm run check`（lint + 类型检查 + 测试）。
4. 界面改动装成客户端截电脑 1440×900 和手机 390×844（`scripts/browser/`），自己逐张看过。
5. 提交：一个关注点一次提交。提交信息第一行是中文一句话、不超过 72 个字，说做了什么；空一行；下面分点写影响范围和原因。
   不写「修复若干问题」。作者 AaronMYL，不写共同作者行。
6. 汇报三样分开说：测试过了、截图看了、真实行为验了；没验证的写清没跑什么、为什么。

## 自动检查（都在 `npm run check` 里）

| 规矩 | 检查 |
|---|---|
| 行宽、一行一个语句、三元层数、空 catch、any、文件长度、CSS 一行一条声明、文件名不用里程碑、测试不许无条件跳过 | `scripts/lint.ts`（规则在 `scripts/lint-rules.ts`、`lint-statements.ts`、`lint-css.ts`，测试 `lint-rules.test.ts`） |
| 类型、可擦除语法、没用到的导入和变量 | `npm run typecheck`（`tsconfig.json`、`client/tsconfig.json`） |
| 模块只经 `index.ts` 往来、根上不放散文件 | `agent/tests/structure/module-boundary.test.ts` |
| 界面分层只能往下引、不直接 fetch、测试不放 src/ | `client/tests/structure-layers.test.ts` |
| 提交信息第一行不超过 72 个字 | `agent/tests/structure/commit-message.test.ts` |
| 界面令牌检查器只有一份 | `scripts/token-check/`（云端和提交前检查用同一份） |
| Apache-2.0 文件的引用边界 | `agent/tests/shared/license-boundary.test.ts` |
| 日志只经 `util/` | `agent/tests/util/log.test.ts` |
| 界面的令牌、用词、图标、布局 | 见 plasticine-visual 的 `page-spec.md` 末尾 |
| 公开仓库不带真人资料 | `node scripts/scan-tests.ts`（推送前） |
| 库里每张表都归了迁移的类 | `agent/tests/state/migration-db.test.ts` |

真有例外，在那一行写「例外：原因」或登记在对应检查的名单里，并写进这份规范。在 Plasticine 内部，技能用
`skills_search` 找、`skill_read` 读正文和参考。
