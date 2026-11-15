# 给写代码的 agent

这份是 Claude、Codex 等编码 agent 共用的入口，读完再动手。2026-11-09 起，这个公开仓库就是 Plasticine 的正本：
Agent、界面、桌面客户端都在这里改、测、打包、发版。Cyber Hunter 的中心中继不在这里，见
[docs/open-source-exclusions.md](docs/open-source-exclusions.md)。

## 必读

1. `agent/skills/plasticine-code/SKILL.md`：代码规矩的正本（不管哪个 Agent 来写都照它做）。
   - 「改什么去哪」看它的 `references/structure.md`：先分外部技术（`state/`、`app/` 等）和内部业务（一个业务一个包），
     模块之间只经 `index.ts` 往来。
   - 行宽 ≤ 120、一行一个语句、三元最多两层、不吞错误、没用到的导入删掉；一文件一职责（源码 500 行、CSS 800 行）。
     违反了 `npm run check` 不过。
   - 先写测试再实现，测试按行为放；schema 两端共享。审查时用它的 `references/review-checklist.md`。
   - 定下新规矩：当场写进 SKILL.md，能自动检查的同时加一条检查进 `npm run check`（已有的检查列在 SKILL.md 末尾）。
2. `agent/skills/plasticine-visual/SKILL.md`：界面规矩，只在改界面时读。
   - 页面模板、页头、内容宽度、组件、加载、空、动效、文案的统一规范在它的 `references/page-spec.md`，每次改界面都照它做；
     它是界面规矩的正本（设计稿画布、聊天只是过程）。定下新规矩：当场写进 `page-spec.md`，能自动检查的同时在
     `client/tests/` 或 `scripts/token-check/` 加一条检查进 `npm run check`（已有的检查列在 `page-spec.md` 末尾）。
3. [docs/dev-workflow.md](docs/dev-workflow.md)：怎么装、怎么测、怎么截图、怎么发版。
4. [CONTRIBUTING.md](CONTRIBUTING.md)：外部贡献的流程。

产品上的决定和讨论记录不放在这个仓库里，在维护者自己的项目文档中。代码注释里写到的「第 N 条」「《优化清单》」「11-07 他定」，
都是指那里的记录。

## 硬规矩

- **仓库是公开的**：推上去就公开。
  - 密码、密钥、令牌不进代码、日志、测试和提交。
  - 不放任何真人的个人资料：姓名、账号、邮箱、IP、住处、私有仓库或私人网页的链接、聊天和记忆内容，都不行。
  - 测试和假接口只用虚构的人和事；示例网址用 `example.com`、`github.com/example/…`。
  - 推送前跑 `node scripts/scan-tests.ts`。
- **许可边界**：Plasticine 是 AGPL-3.0；`agent/protocol/` 和 `agent/shared/` 里开头标了
  `// SPDX-License-Identifier: Apache-2.0` 的文件是 Apache-2.0，闭源的 Cyber Hunter 中继只用这些。
  - Apache-2.0 的文件只能引用别的 Apache-2.0 文件、node 内置和 npm 包（`agent/tests/shared/license-boundary.test.ts` 查）；
  - 新的线上格式放进 Apache-2.0 那边，网络之外的功能放 AGPL 这边。
- **提交作者是 AaronMYL**：`git config user.name AaronMYL`，邮箱用 GitHub 给的 noreply 地址；提交里不写共同作者行。
- **先问再做**：新增依赖、改数据库结构（新迁移）、改接口或线上格式、删除分支 / 标签 / Release，先问维护者。
- **不删用户数据**：迁移只加不改，删除只记 `deleted_at` / `removed_at`；例外是「最近删除」的清空和永久删除：
  正文、修订和文件真删，只保留一行 `purged_at` 删除记录；迁移号在 `agent/src/state/migrations/` 里顺延。
- **信息身份必须真实**：用户原话、系统处理、推测、现实结果分开记；系统不能冒充用户确认。
- **只用可擦除的 TypeScript 语法**：Node 24 直接跑 `.ts`（类型剥离）。
  - 不用 `enum`、`namespace` 和参数属性；
  - 相对导入写 `.ts` 后缀；类型导入用 `import type`。
- **测试**：不连网，不用真实模型，外部服务都用假实现。
  - 服务端、脚本、桌面的测试用 `node:test`；
  - 界面（`client/`）用 Vitest + Testing Library。
- **工作流**：`.github/workflows/` 只用 GitHub 托管机器，不放密钥，不用自托管 runner。

## 怎么跑

- `npm ci`，然后 `npm run check`，等于 lint + 类型检查 + 测试。
- 细节（并行开发、截图、浏览器回归、发版）见 [docs/dev-workflow.md](docs/dev-workflow.md)。
