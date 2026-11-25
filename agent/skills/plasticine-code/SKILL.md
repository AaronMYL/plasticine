---
name: plasticine-code
description: Plasticine 与 Cyber Hunter 共享的代码规范正本：模块按内部业务与外部技术拆分且仅经 index.ts 往来；行宽 ≤ 120、一行一语句、默认禁止行内注释、严禁中文注释与中文测试标题/Commit、先测试后实现、不吞错误，全部由 npm run check 自动守卫。
---

# Plasticine 代码规范

本文件是代码规范正本，所有 Agent 及维护者统一遵守（私有仓库 `AaronMYL/Cyber-Hunter` 同样适用）。界面规范见 `plasticine-visual`（正本 `references/page-spec.md`）。

动手前先读相关模块的 `index.ts`、schema 与现有测试。目录地图见 [structure.md](references/structure.md)，测试规范见 [testing.md](references/testing.md)，自查清单见 [review-checklist.md](references/review-checklist.md)。

## 目录与模块化原则

按三条标准划分目录与文件：**很快知道改哪里**、**改的时候少读上下文**、**连带修改少**。

- **外部技术 vs 内部业务**：数据库（`state/`）、HTTP 路由（`app/`）、外部服务与设备（`cloud-tools/`、`devices/`、`kernel/`）归外部技术；每个业务领域独立建包（如 `memory/`、`notes/`、`video/`、`mates/`）。
- **不过度抽象**：存储仅有 SQLite，不做无意义的依赖倒置；业务包内不再强拆领域层/应用层；不为尚未出现的需求预写接口。
- **及时整理债务**：发现放错位置、重复代码或违规写法，当场清理，并与功能改动分开提交。

## 硬底线（违反任意一条 `npm run check` 不通过）

1. **格式与结构**：行宽 ≤ 120；一行一个语句（单语句短块除外）；CSS 一行一条声明且闭合 `}` 对齐；三元表达式最多嵌套两层。
2. **注释与语言规范**：
   - **默认禁止行内注释**（`no-inline-comment`）：优先通过清晰的命名和结构自解释。
   - **文档优先**：需要说明模块或公共接口意图时，使用标准**英文**文档注释（TS/JS `/** ... */`，Swift/C# `///`，Python docstring）。
   - **受控例外**：仅在逻辑极其复杂、非写不可时允许极简英文 `// Invariant: <reason>` 或 `// Workaround: <reason>`；样式/结构豁免统一使用 `/* allow-exception: <reason> */` 或 `// allow-exception: <reason>`；Apache-2.0 文件首行保留 `// SPDX-License-Identifier: Apache-2.0`。
   - **严禁中文**（`no-cjk-comment` / `no-cjk-test-title`）：代码中严禁出现任何中文注释，测试与套件标题一律用英文；仅产品界面面向用户的文案保留中文。
3. **不吞错误**（`empty-catch`）：禁止空的 `catch {}`，必须处理、带上下文抛出或记录日志并置为待核实状态。
4. **严格边界**：
   - `agent/src/` 各模块间只经 `index.ts` 往来，根目录不放散文件，模块内部兄弟文件直接互引不绕 `index.ts`。
   - `client/src/` 严格单向分层：`api/` → `state/` → `primitives/` → `views/` → `shell/`；组件不直接 `fetch` 本体接口；测试不放 `src/`。
5. **类型与可擦除语法**：启用最严 TypeScript 配置，禁止显式 `any`（`no-any`）；禁用 `enum`、`namespace`、参数属性；相对导入带 `.ts` 后缀，类型导入用 `import type`。
6. **测试卫生**（`no-skipped-test`）：禁止 `.skip`、`.only`、`.todo` 及无条件 `skip: true`；环境相关跳过必须写英文条件原因（`{ skip: hasTool ? false : 'ffmpeg not installed' }`）。
7. **命名与文件长度**：文件名用 kebab-case 描述职责，禁止里程碑或批次前缀（`file-name`）。源码 500 行、CSS 800 行软上限；确属单一职责的登记于 `scripts/lint-rules.ts` 的 `LONG_FILES_ALLOWED`（私有仓登记于 `scripts/lint-local.json`）。
8. **单一事实来源**：不复制逻辑；私有仓同步的公开文件必须与正本逐字节一致。

## 编码约定

- **命名**：文件 `kebab-case`，类型 `PascalCase`，函数/变量 `camelCase`，常量 `UPPER_SNAKE`。
- **面向用户文案**：界面与用户可见报错为简洁中文（说明问题 + 下一步），不暴露堆栈。
- **输入与状态**：外部输入先过 TypeBox schema 校验；时间存 ISO 字符串按用户时区展示；金额用整数分；ID 用稳定字符串。
- **异步与日志**：长任务支持 `AbortSignal`；定时器和订阅必须清理；服务端日志仅经 `util/log.ts`，禁止直接使用 `console`。
- **上游内核与前端栈**：模型调用统一经 `kernel/` 与 `lines/`（锁定 `@earendil-works/pi-ai` / `pi-agent-core` 版本，不 fork）；前端使用 React + Vite + 原生 CSS + 令牌变量（`client/src/tokens.css`），不引入 UI 库或 Tailwind。

## 接口与数据

- 接口 schema 与类型统一定义在 `agent/shared/`，客户端只从 `client/src/api/shared.ts` 导入。
- `app/` 只负责路由、参数校验、调用业务包与组装响应，不写业务规则、不碰数据库。
- 只有 `state/` 直接操作 SQLite；迁移只加不改，删除表/列的 `destructive` 迁移需在 `changes` 声明变更表并在上线前演练。新表需登记到 `state/migration-tables.ts`。
- 副作用操作需带稳定幂等标识；线的状态仅经 `LineKernel` 变更。

## 每次改动的流程

1. 读相关模块的 `index.ts`、schema 与测试，明确改动边界。
2. 先写失败的英文标题测试，再实现代码。
3. 运行 `npm run check` 确保全部检查通过；推送公开仓前运行 `node scripts/scan-tests.ts`。
4. 界面改动需截取桌面（1440×900）与手机（390×844）视图自查。
5. **英文提交**：一个关注点一次提交，使用英文 Conventional Commits（如 `feat: ...`、`fix: ...`、`refactor: ...`、`docs: ...`、`chore: ...`），首行 ≤ 72 字符，无 `Co-Authored-By`，作者 `AaronMYL`。

## 自动检查一览（全部包含在 `npm run check`）

| 规范 | 检查位置 |
|---|---|
| 行宽、单语句、三元深度、空 catch、any、文件长度、CSS 格式、文件名、跳过测试、禁中文注释、禁行内注释、禁中文测试标题 | `scripts/lint.ts`（`lint-rules.ts`、`lint-statements.ts`、`lint-css.ts`） |
| 类型检查与可擦除语法 | `npm run typecheck` |
| `agent/src/` 模块边界与独立加载 | `agent/tests/structure/module-boundary.test.ts` |
| `client/src/` 分层与禁止直连 fetch | `client/tests/structure-layers.test.ts` |
| 全英文 Commit、首行 ≤ 72 字符、无共同作者 | `agent/tests/structure/commit-message.test.ts` |
| 界面令牌（颜色/阴影/字号/数值） | `scripts/token-check/check.test.ts` |
| Apache-2.0 许可引用边界 | `agent/tests/shared/license-boundary.test.ts` |
| 服务端日志白名单 | `agent/tests/util/log.test.ts` |
| 公开仓密钥与 `.only` 扫描 | `node scripts/scan-tests.ts` |
| 数据库表迁移分类登记 | `agent/tests/state/migration-db.test.ts` |
