# 开发流程

规矩以 [AGENTS.md](../AGENTS.md) 为准，这份只讲「怎么做」。

## 一、装好环境

1. Node 24：`node -v` 要是 24.x。
2. 仓库根目录 `npm ci`（`client/` 是工作区，会一起装）。桌面客户端在 `desktop/` 里另外 `npm ci`。
3. 浏览器回归和截图使用本机 Chrome / Edge / Playwright Chromium，`scripts/browser/cdp.ts` 会自动探测 macOS / Windows / Linux 常见路径（也可通过 `PLASTICINE_TEST_BROWSER` 指定）。

## 二、开发与 Git 节奏

- **单主干直接推送**：常规改动在全量本地门禁通过后直接提交并推送 `main`。
- **大改暂留隔离**：涉及数据库迁移、线上协议/接口变更或大范围重构时，先留本地或开临时工作区让维护者过目后再合并推送：

  ```sh
  git worktree add -b <分支> ../wt-<名> origin/main
  (cd ../wt-<名> && npm ci)
  ```

  不要软链别的工作区的 `node_modules`；合入 `main` 后立即清理临时分支与 worktree。
- **迁移号**：开工前看 `agent/src/state/migrations/` 里的最大号，避免撞号；迁移只加不改，合并时保留两侧新增记录。

## 三、本地验证（分层门禁）

1. **开发中**：运行相关定向测试与 `npm run -s typecheck && npm run -s lint`。
2. **推送 `main` 前**：必跑完整 `npm run check` 与 `node scripts/scan-tests.ts`。
3. **浏览器回归**：改动界面、路由或桌面壳层时本地运行受影响的 `browser-tests` 用例；全量浏览器回归与桌面端冒烟由 `.github/workflows/build.yml` 在发版时兜底。

| 什么 | 命令 |
|---|---|
| 类型 + lint | `npm run -s typecheck && npm run -s lint`（格式也算 error；登记过的超长文件只提醒） |
| 界面全量 | `cd client && TZ=Asia/Shanghai npx vitest run` |
| 服务端全量 | `TZ=Asia/Shanghai node --test --test-concurrency=6 "agent/tests/**/*.test.ts" "scripts/**/*.test.ts"`（约 8 分钟） |
| 桌面客户端 | `cd desktop && npm test` |
| 浏览器回归 | `cd client && TZ=Asia/Shanghai npm run test:browser` |
| 测试里的密钥扫描 | `node scripts/scan-tests.ts` |
| 技能同步 | 技能正本在 `agent/skills/`，改完跑 `npm run skills:sync` |
| 角色引擎（队友头像） | 打包好的在 `client/src/vendor/plasticine-bot/`；引擎更新时在它的检出里构建，再 `node scripts/vendor-plasticine-bot.ts <检出目录>` |

- 测试统一用上海时区。`npm test`、`npm run check` 和 `client/` 里的 vitest 自己设（`scripts/test-env.ts`、`client/vite.config.ts`），
  不用在命令前写；只有像上表那样直接跑 `node --test` 时要自己带 `TZ=Asia/Shanghai`。
- 环境里开着代理（`NODE_USE_ENV_PROXY=1`）时，连本机的测试单独设 `NODE_USE_ENV_PROXY=0`。
- 界面里不许写死颜色：真要新颜色，在 `client/src/tokens.css` 加令牌，同时登记进 `scripts/token-check/check.ts` 的令牌表，
  再写进 `agent/skills/plasticine-visual/references/visual-foundation.md`。

## 四、界面设计与截图验收（分级）

- **小幅调整 / 修 Bug**：严格对照 `agent/skills/plasticine-visual/references/page-spec.md` 直接修改，并按下方步骤截取桌面（1440×900）与手机（390×844）视图自审。
- **新页面 / 较大改版**：先出轻量原型或方案与维护者对齐后再进入实现。

1. 起假接口的 Vite：`cd client && npx vite --host 127.0.0.1 --port <端口> --strictPort`。
2. 截图：`node scripts/browser/client-shots.ts http://127.0.0.1:<端口>/ <输出目录> jobs.json`。
3. `jobs.json` 是数组，每项是 `{ "name", "client": "mac" | "phone" | "web", "hash", "theme"?, "query"?, "steps"? }`：
   - `mac` 是 1440×900、装成桌面客户端；
   - `phone` 是 390×844 的手机网页；
   - 步骤可以是一段 JS、`{ "wait": 毫秒 }`、`{ "click": 选择器 }`、`{ "clickText": 文字 }` 或 `{ "hover": 选择器 }`。
4. 截完按进程号停掉 Vite。每张自己看一遍。

## 五、发版（按需触发）

1. 纯文档、内部重构或测试优化只推 `main` 不发版；用户可见的新功能或线上修复在验证通过后按需求发版（默认确认后再触发，若需求已明确要求上线则直接触发）。
2. 改动合进 `main`、`npm run check` 与 `node scripts/scan-tests.ts` 通过后，在 `main` 上手动触发 `.github/workflows/build.yml`（workflow_dispatch）。它用 GitHub 托管机器打出这几样，并各自冒烟：
   - Linux 服务包
   - Mac / Windows 桌面客户端
3. 构建全过以后，下载站十分钟内从这次构建取包发布。装了安装包的实例会自己更新，坏版本自动退回。
4. 带数据库迁移的改动，触发构建前先在一份真实库的副本上把迁移跑一遍，看行数、外键和完整性检查。迁移只加不改，
   装上以后退回旧版会认不得新库。

## 六、桌面客户端（`desktop/`）

- Mac、Windows 共用一套 Electron 壳。
- 设备能力按系统各写一份助手：Mac 是 `mac/` 里的 Swift 代码，Windows 在 `desktop/helpers/windows/`。
- 改了 `desktop/` 先跑 `cd desktop && npm test`。冒烟脚本是 `desktop/build/smoke.ts`，CI 里会跑。
- 本地 macOS 真窗口调试可执行 `cd desktop && npm start`；在 Linux CI / Xvfb 无头环境下可用 `ffmpeg -f x11grab -framerate 60` 逐帧录屏检查切换与闪烁。

### 数据库副本演练

带迁移的版本在构建前运行 `node scripts/rehearse-migrations.ts <源库路径> <全新演练目录>`。
脚本只读源库，先做 SQLite 一致性备份，再在副本应用迁移；核对原表行数、外键、完整性和重复运行，
结果写到副本目录的 `migration-report.json`。目标目录必须不存在，演练文件保留供核对。生产库的演练仍通过运维通道执行。
