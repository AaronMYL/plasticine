# Plasticine

跑在你自己电脑或服务器上的私人 AI 工作台。对话、笔记、任务、记忆、联系人和聊天都在你自己的那一份里。

A personal AI workspace that runs on your own computer or server. Chat, notes, tasks, memory, contacts and messages
live in your own instance. Mac and Windows get a desktop client; phones use the web app. The UI is Chinese for now.
Licensed under AGPL-3.0; `agent/protocol/` and the wire-format files in `agent/shared/` are Apache-2.0. Commercial use is welcome.

> 早期版本，一份 Plasticine 只有一个主人。欢迎来改，见 [CONTRIBUTING.md](CONTRIBUTING.md) 和 [悬赏](BOUNTIES.md)。

## 下载安装

下载页：<https://cyberhunter.top/download>

| 平台 | 装 | 第一次打开 |
|---|---|---|
| Mac | 下载 `Plasticine-Desktop-mac-<版本>.dmg`，把 Plasticine 拖进「应用程序」 | 右键「打开」。钥匙串问到「Plasticine Local Signing」「Plasticine Safe Storage」时点「始终允许」 |
| Windows | 下载 `Plasticine-Desktop-Setup-<版本>.exe`，双击 | SmartScreen 拦下时点「更多信息 → 仍要运行」 |
| Linux / VPS | `curl -fsSL https://cyberhunter.top/download/install.sh \| sudo sh` | 装完会打印一条建账号链接（30 分钟内有效）。服务器没有图形界面时，先在自己电脑上 `ssh -L 8790:127.0.0.1:8790 <用户>@<服务器>`，再用浏览器打开那条链接 |

每个文件的版本和 SHA-256 在 [manifest.json](https://cyberhunter.top/download/manifest.json)（桌面客户端在
[desktop.json](https://cyberhunter.top/download/desktop.json)）。

## 第一次用

1. 桌面客户端先问在哪里用：
   - **在这台电脑上**：数据只在这台电脑里，Mac 合上盖子、Windows 关机它就停。第一次用选这个。
   - **连到我的 Plasticine**：已经在服务器或另一台电脑上用着，填 `@账号` 或地址，再用密码登录。
   以后在「设置 → 系统」里能换；菜单「Plasticine → 连接到…」（Windows 在托盘里）也回到这一步。
2. 建账号：名字、`@账号`、密码一步填完。起了 `@账号` 就加入了 Cyber Hunter 网络，不要邀请码。密码只存在你自己这份
   Plasticine 里。
3. 连一个模型：用你已有的订阅登录（比如 ChatGPT），或者填 API Key。
   - 订阅登录会打开浏览器。登录完跳不回来时，点「粘贴回调地址」，把浏览器地址栏里的地址粘进来。
   - 以后在「设置 → AI」里换模型、加提供商。提供商列表来自 [pi-ai](https://github.com/earendil-works/pi)。
4. 在手机上也能用：手机浏览器打开 `https://<账号>.cyberhunter.top`（账号不带 @），用 `@账号` + 密码登录。

在本机用的桌面客户端每次自动登录；手机和别的电脑用 `@账号` + 密码登录。

忘了密码：桌面客户端在这台电脑上用时，菜单里有「重设密码…」；Linux 上运行 `sudo plasticine password`。

## 有什么

| 栏目 | 里面是什么 |
|---|---|
| 首页 | 等你定的事、在做的事、今天的日历和提醒事项（Mac）、接着看的笔记 / 书 / 网页 |
| Plasticine | 主线和旁聊；记忆在最下面 |
| 消息 | 人、群、邮件。联系人能问你的 Plasticine，能答多少按设置里的「对外可见」 |
| 任务 | 在做、等你、定时、建议，以及项目 |
| 网页 | 竖排标签：置顶、分组、今天；书签单独一节。对话框能「问这一页」 |
| 信息流 | 订阅网址、关注点、Reddit；开着桌面客户端时还能接 X 关注和抖音收藏 |
| 笔记 | 自己写的笔记，写的时候有续写和补充建议 |
| 图书 | 导入 epub、txt、mobi、azw3 来读 |
| 资料库 | 订阅、空间（Plasticine 写的报告和来信，整页排版）、文件、最近删除 |

<kbd>⌘K</kbd>（Windows 上 <kbd>Ctrl K</kbd>）搜标签、笔记、空间、项目和旁聊。手机底栏是首页、Plasticine、消息、笔记和「更多」。

手机上用浏览器打开自己的地址就行；加到主屏幕后没有地址栏，也能收系统通知（iPhone 在 Safari 点「分享 → 添加到主屏幕」）。

## 更新

| 平台 | 自动更新 | 手动 |
|---|---|---|
| 桌面客户端 | 每 6 小时查一次，下好了提示「重新打开」；新版起不来会自动退回上一版 | 菜单「检查更新…」 |
| Linux | 开机两分钟后和之后每天；新版不健康自动退回 | `sudo plasticine update`，回到上一版 `sudo plasticine rollback` |

更新不碰你的数据。

## 数据在哪

| 平台 | 数据 |
|---|---|
| Mac | `~/Library/Application Support/Plasticine/server` |
| Windows | `%LOCALAPPDATA%\Plasticine\state` |
| Linux | `/var/lib/plasticine/state`，设置在 `/etc/plasticine/plasticine.env` |

卸载：Mac 删掉 App；Windows 在「设置 → 应用」里卸载，最后会问要不要连数据一起删；Linux 运行
`curl -fsSL https://cyberhunter.top/download/install.sh | sudo sh -s -- --uninstall`（数据保留，加 `--purge` 连数据删）。
细节见 [docs/install-packages.md](docs/install-packages.md)。

## 从源码跑

需要 Node 24（最低 24.11）。`agent` 和 `client` 是 npm workspaces，`desktop/` 另外装。

```sh
npm ci
npm run check        # lint、类型检查与全部测试
npm run build -w client
PLASTICINE_STATE=./state PLASTICINE_CLIENT_DIR=client/dist PLASTICINE_PLAIN_HTTP=1 node agent/src/app/main.ts
```

然后打开 `http://127.0.0.1:8790/`。Linux 上服务要以 `plasticine` 用户运行（本机备份目录检查属主）；Mac 上直接跑。

改代码前先读 [AGENTS.md](AGENTS.md) 和 [docs/dev-workflow.md](docs/dev-workflow.md)；写代码和界面的规矩在
[agent/skills/](agent/skills/)。自己打安装包见 [docs/install-packages.md](docs/install-packages.md)，桌面客户端见
[desktop/README.md](desktop/README.md)。

| 目录 | 是什么 |
|---|---|
| `agent/src/` | 服务端（Node 24 直接跑 TypeScript） |
| `agent/protocol/` | 连 Cyber Hunter 网络的那一头：签名、加密、隧道、证书（Apache-2.0） |
| `agent/shared/` | 服务端和界面共用的 schema；线上格式那几个文件是 Apache-2.0 |
| `client/` | React + Vite 网页界面 |
| `desktop/` | Electron 桌面客户端（Mac / Windows） |
| `mac/` | Mac 原生 App 与设备助手（Swift） |
| `scripts/packages/` | 安装包、更新器和发布清单 |

Cyber Hunter 的中心中继是独立服务，不在这个仓库里（见 [docs/open-source-exclusions.md](docs/open-source-exclusions.md)）；
实例这一头：协议和隧道客户端在 `agent/protocol/`，联系人、同步这些在 `agent/src/network/`。

## 许可证

- Plasticine 按 [AGPL-3.0](LICENSE) 开源。个人、公司都可以免费使用、修改、拿来做生意；
  把改过的版本发给别人，或者放到网上给别人用，要按 AGPL 把对应的源码给他们。
- `agent/protocol/`，和 `agent/shared/` 里开头标了 Apache-2.0 的文件（线上格式和它们用到的类型），按 [Apache-2.0](LICENSES/Apache-2.0.txt)：拿去接自己的服务、写别的客户端都行，不要求公开源码。
- 「Plasticine」「Cyber Hunter」的名字和图标不在代码许可里，见 [TRADEMARKS.md](TRADEMARKS.md)。

版权 © AaronMYL。2026-11-09 当天有几个版本按 PolyForm Noncommercial 1.0.0 发布，之后改回 AGPL-3.0。
