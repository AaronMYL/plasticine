# 开发流程

规矩以 [AGENTS.md](../AGENTS.md) 为准，这份只讲「怎么做」。

## 一、装好环境

1. Node 24：`node -v` 要是 24.x。
2. 仓库根目录 `npm ci`（`client/` 是工作区，会一起装）。桌面客户端在 `desktop/` 里另外 `npm ci`。
3. 浏览器回归和截图用 Playwright 的 Chromium，`scripts/browser/cdp.ts` 会自己去找。

## 二、并行开发（几件事同时做）

- 每件事一个工作区：

  ```sh
  git worktree add -b <分支> ../wt-<名> origin/main
  (cd ../wt-<名> && npm ci)
  ```

  不要软链别的工作区的 `node_modules`。
- 迁移号：开工前看 `agent/src/state/migrations/` 里的最大号，各条线约好从几号起，避免撞号。迁移只加不改。
- 合并时两边的新功能都保住；冲突多半在迁移清单的测试里，两行都留。

## 三、本地验证

| 什么 | 命令 |
|---|---|
| 类型 + lint | `npm run -s typecheck && npm run -s lint`（只看 error，行宽是提醒） |
| 界面全量 | `cd client && TZ=Asia/Shanghai npx vitest run` |
| 服务端全量 | `TZ=Asia/Shanghai node --test --test-concurrency=6 "agent/tests/**/*.test.ts" "scripts/**/*.test.ts"`（约 8 分钟） |
| 桌面客户端 | `cd desktop && npm test` |
| 浏览器回归 | `cd client && TZ=Asia/Shanghai npm run test:browser` |
| 测试里的密钥扫描 | `node scripts/scan-tests.ts` |
| 技能同步 | 技能正本在 `agent/skills/`，改完跑 `npm run skills:sync` |

- 测试统一带 `TZ=Asia/Shanghai`。
- 环境里开着代理（`NODE_USE_ENV_PROXY=1`）时，连本机的测试单独设 `NODE_USE_ENV_PROXY=0`。
- 界面里不许写死颜色：真要新颜色，在 `client/src/tokens.css` 加令牌，同时登记进 `agent/src/system/token-check.ts` 的令牌表，
  再写进 `agent/skills/plasticine-visual/references/visual-foundation.md`。

## 四、截图（装成客户端）

1. 起假接口的 Vite：`cd client && npx vite --host 127.0.0.1 --port <端口> --strictPort`。
2. 截图：`node scripts/browser/client-shots.ts http://127.0.0.1:<端口>/ <输出目录> jobs.json`。
3. `jobs.json` 是数组，每项是 `{ "name", "client": "mac" | "phone" | "web", "hash", "theme"?, "query"?, "steps"? }`：
   - `mac` 是 1440×900、装成桌面客户端；
   - `phone` 是 390×844 的手机网页；
   - 步骤可以是一段 JS、`{ "wait": 毫秒 }`、`{ "click": 选择器 }`、`{ "clickText": 文字 }` 或 `{ "hover": 选择器 }`。
4. 截完按进程号停掉 Vite。每张自己看一遍，界面改动的 PR 要附电脑和手机截图。

## 五、发版

1. 改动合进 `main`，`npm run check` 过。
2. 在 `main` 上手动触发 `.github/workflows/build.yml`（workflow_dispatch）。它用 GitHub 托管机器打出这几样，并各自冒烟：
   - Linux 服务包
   - Windows 安装程序
   - Mac App
   - Mac / Windows 桌面客户端
3. 构建全过以后，下载站十分钟内从这次构建取包发布。装了安装包的实例会自己更新，坏版本自动退回。
4. 带数据库迁移的改动，触发构建前先在一份真实库的副本上把迁移跑一遍，看行数、外键和完整性检查。迁移只加不改，
   装上以后退回旧版会认不得新库。

## 六、桌面客户端（`desktop/`）

- Mac、Windows 共用一套 Electron 壳。
- 设备能力按系统各写一份助手：Mac 是 `mac/` 里的 Swift 代码，Windows 在 `desktop/helpers/windows/`。
- 改了 `desktop/` 先跑 `cd desktop && npm test`。冒烟脚本是 `desktop/build/smoke.ts`，CI 里会跑。
- Xvfb 下可以起真窗口录屏：用 `ffmpeg -f x11grab -framerate 60` 逐帧看切换、闪烁这类问题。
