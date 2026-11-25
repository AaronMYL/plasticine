# 给写代码的 Agent（Plasticine 公开仓库）

本仓库（`AaronMYL/plasticine`）是 Plasticine 的正本：Agent、Web 界面、Electron 桌面客户端、Mac 设备助手、安装包与官网均在此开发、测试和发版。Cyber Hunter 中继与腾讯云运维在私有仓库 `AaronMYL/Cyber-Hunter`，许可边界见 [docs/open-source-exclusions.md](docs/open-source-exclusions.md)。

## 必读规范

1. **代码规范**：`agent/skills/plasticine-code/SKILL.md`（模块目录见 `references/structure.md`，测试见 `references/testing.md`，审查见 `references/review-checklist.md`）。
2. **界面规范**：`agent/skills/plasticine-visual/SKILL.md` 及 `references/page-spec.md`（改界面时必读）。
3. **开发与发版流程**：[docs/dev-workflow.md](docs/dev-workflow.md) 与 [CONTRIBUTING.md](CONTRIBUTING.md)。

## 代码、注释与提交规范（`npm run check` 强制校验）

- **默认禁止行内注释**：优先通过清晰的命名和代码结构自解释（`no-inline-comment`）。
- **文档优先**：需要说明模块或公共接口意图时，使用标准**英文**文档注释（TS/JS 用 `/** ... */`，Swift/C# 用 `///`，Python 用 docstring）。
- **例外情况**：仅在逻辑极其复杂、非写不可时，允许极简英文 `// Invariant: <reason>` 或 `// Workaround: <reason>`；样式或结构检查豁免统一写 `/* allow-exception: <reason> */` 或 `// allow-exception: <reason>`。
- **严禁中文**：代码中禁止出现任何中文注释（`no-cjk-comment`），测试与套件标题统一使用英文（`no-cjk-test-title`），检查器输出使用英文；仅产品面向用户的界面文案保留中文。
- **严禁中文 Commit**：提交信息必须使用**英文**（推荐 Conventional Commits，如 `feat:`、`fix:`、`refactor:`、`docs:`、`test:`、`chore:`），首行不超过 72 字符，不写 `Co-Authored-By`（`commit-message.test.ts` 全量校验）。提交作者固定为 `AaronMYL`（GitHub noreply 邮箱）。

## 硬规矩

- **公开仓库零隐私**：严禁将密码、密钥、令牌、真人姓名、邮箱、IP、私人链接或聊天/记忆原文带入代码、测试、日志或提交；测试仅使用虚构数据，推送前跑 `node scripts/scan-tests.ts`。
- **许可边界**：主体为 AGPL-3.0；`agent/protocol/` 与 `agent/shared/` 中首行标注 `// SPDX-License-Identifier: Apache-2.0` 的文件为 Apache-2.0（仅可引用其他 Apache-2.0 文件、Node 内置及 npm 包，由 `license-boundary.test.ts` 守卫）。
- **先问再做**：新增依赖、新增数据库迁移、修改公共接口或线上协议格式、删除分支/标签/Release 前需先确认。
- **数据安全**：数据库迁移只增不改；产品删除默认软删（`deleted_at` / `removed_at`），仅「最近删除」的清空/永久删除真删正文与文件并保留 `purged_at` 记录。
- **信息身份真实**：用户原话、系统处理、推测、现实结果严格区分；系统不冒充用户确认。
- **可擦除 TypeScript（Node 24）**：直接运行 `.ts`（类型剥离），禁用 `enum`、`namespace`、参数属性；相对导入带 `.ts` 后缀，类型导入用 `import type`。
- **测试隔离**：测试不联网、不调真实模型、外部服务全用假实现；服务端/脚本/桌面用 `node:test`，界面（`client/`）用 Vitest + Testing Library。
- **工作流约束**：`.github/workflows/` 仅使用 GitHub 托管机器，不放密钥。

## 常用命令

- 安装依赖：`npm ci`（含 `client/` 工作区），桌面端另在 `desktop/` 执行 `npm ci`。
- 全量检查：`npm run check`（`lint` + `typecheck` + 服务端/脚本/桌面/界面测试）。
- 推送前安全扫描：`node scripts/scan-tests.ts`。
