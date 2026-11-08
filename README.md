# Plasticine

一个跑在你自己电脑或服务器上的私人 AI 工作台：对话、笔记、项目、记忆、联系人和聊天都在你自己的实例里。
网页是正式端，手机通过网页使用；Mac 和 Windows 另有桌面客户端。

A personal AI workspace that runs on your own computer or server. Conversations, notes, projects, memory, contacts and
chat all live in your own instance. The web app is the main client (phones use it too); Mac and Windows also get a
desktop shell.

> 状态：早期、单用户、界面是中文。欢迎来改，见[悬赏](BOUNTIES.md)。
> Status: early, single-user, Chinese UI. Contributions welcome, see [Bounties](BOUNTIES.md).

## 安装自己的实例

| 平台 | 安装方式 | 使用方式 |
|---|---|---|
| Linux / VPS | 一行安装脚本 | 浏览器连接自己的实例 |
| Mac | 下载 App 压缩包，拖入「应用程序」 | App 自带服务；也可连接远端实例 |
| Windows | 下载并运行安装器 | 托盘看护服务，默认浏览器打开网页 |

安装、更新、卸载和自己构建安装包，见 [docs/install-packages.md](docs/install-packages.md)。官方发布点是
`https://cyberhunter.top/download`，[版本清单](https://cyberhunter.top/download/manifest.json) 给出每个平台的文件地址、
版本和校验值。

## 开发

需要 Node 24（最低 24.11），在仓库根目录安装依赖；`agent` 和 `client` 是 npm workspaces，`desktop/` 单独装。

```sh
npm ci
npm run check        # lint、类型检查与全部测试
npm run build -w client
PLASTICINE_STATE=./state PLASTICINE_CLIENT_DIR=client/dist PLASTICINE_PLAIN_HTTP=1 node agent/src/app/main.ts
```

然后打开 `http://127.0.0.1:8790/`。Linux 上服务要以 `plasticine` 用户运行（本机备份目录检查属主）；Mac 上直接跑。写代码的规矩在 [agent/skills/](agent/skills/)（`plasticine-code`、`plasticine-visual`）。

## 目录

| 目录 | 是什么 |
|---|---|
| `agent/src/` | 服务端（Node 24 直接跑 TypeScript）：线运行时与模型内核、记忆、笔记、项目、联系人、设备、网络 |
| `agent/shared/` | 服务端和界面共用的 schema |
| `agent/skills/` | 开发技能（写、审 Plasticine 代码的规矩），运行时不加载 |
| `agent/deploy/` | 在自己服务器上用 systemd + Caddy 跑的参考配置 |
| `client/` | React + Vite 网页界面、普通 CSS 和令牌 |
| `desktop/` | Electron 桌面客户端（Mac / Windows） |
| `mac/` | Mac 原生 App 与设备助手（Swift） |
| `scripts/packages/` | 三平台安装包、更新器和发布清单 |
| `scripts/browser/` | 无头浏览器装成客户端截图验收 |

Cyber Hunter 的中心中继是独立服务，不在这个仓库里（见 [docs/open-source-exclusions.md](docs/open-source-exclusions.md)）；
实例这一头的网络和隧道客户端在 `agent/src/network/`。

## 许可证

[AGPL-3.0](LICENSE)。你可以自由使用、修改、自己部署；如果把改过的版本做成网络服务给别人用，需要按 AGPL 公开你的改动。
