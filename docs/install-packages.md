# 安装包：Linux 服务包 + 桌面客户端

两种装法让用户各自运行自己的 Plasticine 实例：Linux VPS 上装服务包；Mac、Windows 上装桌面客户端（Electron 壳，
`desktop/`），它自带同一个服务包，可以在本机起一份，也可以连到服务器上那份。服务只听 `127.0.0.1:8790`；网页是正式端，
手机也通过网页访问自己的实例。原来的 Swift Mac App 和 Windows 托盘安装程序 2026-11-17 删了（已经没人在用）。

## 下载入口

官方发布点是 `https://cyberhunter.top/download`。服务包和 Linux 安装器的地址来自
[`manifest.json`](https://cyberhunter.top/download/manifest.json)（`assets.server.url`、`assets.linuxInstaller.url`），
桌面客户端的来自 [`desktop.json`](https://cyberhunter.top/download/desktop.json)。安装包本身放在本仓库的 GitHub Releases
（标签 `v<版本>`），清单里的地址指向那里。清单同时给出版本、源码提交、每个文件的 SHA-256 和大小。自己打的包可以用
`--release-url`（构建服务包时）换成自己的发布点。

## 怎么装、怎么更新、怎么卸载

实际可用版本以发布点的清单为准。

| | Linux（VPS） | 桌面客户端（Mac / Windows） |
|---|---|---|
| 装 | `curl -fsSL https://cyberhunter.top/download/install.sh \| sudo sh` | Mac 下载 `Plasticine-Desktop-mac-<版本>.dmg` 拖进「应用程序」；Windows 下载 `Plasticine-Desktop-Setup-<版本>.exe` 运行（没签名，SmartScreen 提示时选「更多信息 → 仍要运行」） |
| 打开 | 装完打印一条建账号链接（见下）；没图形界面先在自己电脑上 `ssh -L 8790:127.0.0.1:8790 <用户>@<VPS>`，再用浏览器打开它 | 先选「在这台电脑上」或「连到我的 Plasticine」（见 `desktop/README.md`） |
| 账号 | 第一次用建账号链接起名字、@账号和密码；以后别的设备用 @账号 + 密码登录；忘了密码 `plasticine password` | 本机那份由客户端直接登录，不问密码 |
| 更新 | 自动：开机后两分钟、之后每天（`plasticine-update.timer`）；马上查：`sudo plasticine update` | 自动：每 6 小时查一次，点了才下、下完重开 |
| 回到上一版 | `sudo plasticine rollback` | 新版起不来自动退回上一版 |
| 程序 | `/opt/plasticine`（`versions/<版本>`，`current`、`previous` 指针，`node/`） | Mac `Plasticine.app`；Windows 装在用户目录 |
| 数据 | `/var/lib/plasticine/state`（`plasticine` 用户），设置 `/etc/plasticine/plasticine.env` | Mac `~/Library/Application Support/Plasticine`；Windows `%LOCALAPPDATA%\Plasticine`（`desktop/src/app/desktop-paths.ts`） |

### 第一次：建账号（2026-11-08，代替配对码）

一份 Plasticine 只有一个主人，账号是「@账号 + 密码」；密码只存在这份 Plasticine 里（scrypt 慢哈希），中继不知道。

- Linux：`install.sh` 装完以 `plasticine` 用户运行 `agent/src/app/setup-link-cli.ts`，打印
  `http://127.0.0.1:<端口>/#/setup?t=<令牌>`（30 分钟内有效、只能用一次；配了 `PLASTICINE_PUBLIC_URL` 另打一行那个地址
  的）。在这个链接里起名字、@账号（顺带在 Cyber Hunter 网络里自助注册，不要邀请码）和密码。过期了运行
  `sudo plasticine setup-link` 再拿一条；已经有主人时它只说一句。
- 2026-11-12：装之前问一句别的设备怎么打开（也可以直接给 `--handle=<@账号>` 或 `--domain=<域名>`，就不问）。
  填 @账号：`setup-link-cli.ts --handle` 先以它加入网络（名字先用 @账号占着，建账号时换成填的名字），退出码 10，
  安装脚本重启服务，隧道连上、证书自己去签，链接打 `https://<账号>.cyberhunter.top/#/setup?t=…`，建账号页上这个 @账号
  锁着。填域名：`--domain` 存成「自己的网址」（设置 · 账号「在别的设备上用」里同一个值），链接打这个域名的；
  反向代理自己配。`sudo plasticine setup-link --handle <@账号>` / `--domain <域名>` 事后也能补。
- 桌面客户端：壳启动本体时给一个本机令牌（环境变量 `PLASTICINE_LOCAL_TOKEN`），本机界面凭它建账号、
  直接登录、重设密码；只认 `127.0.0.1` 直连来的请求。服务器上不设这个变量，也就不认。
- 别的设备（手机、另一台电脑）：@账号或地址 + 密码登录。输错按来源和全局限流。
- 忘了密码：服务器上 `plasticine password`（输两遍、不回显；脚本里 `plasticine password --stdin` 读一行），本机实例在
  桌面客户端里直接重设。已经登录着的设备照旧。
- 搬到另一台（数据迁移）：设置 · 系统「数据迁移」导出、导入；文件太大网页传不动时，服务器上
  `sudo plasticine export [--data-only] <文件>`（全部的问两遍口令，只要数据的不加密）、
  `sudo plasticine import --merge|--replace <文件>`（加了密的问口令，解开后自己重启服务，开库前做完）。
  文件要放在 `plasticine` 用户读写得到的地方；导入前的那一份留 7 天，在设置 · 系统里能退回。
- 老实例（有登录着的设备、还没设密码）照常用，登录着时设一次密码。登录页不收配对码，生成配对码的旧脚本 11-17 删了。

Linux 读发布点的 `manifest.json`，桌面客户端读 `desktop.json`。版本比装着的新才下载，核对 SHA-256 和大小再换上。
Linux 换的是 `current` 指针，不健康自动换回 `previous`，那一版记下不再自动装；桌面客户端的换版和退回见 `desktop/README.md`。

**回退用的备份留多少**（2026-11-13 定，各处一个规则）：同一样东西最多留最新 2 份，每份从生成那一刻起满 7 天就删，两条同时
生效，不够 2 份也照样到期删；自动清，不用人管。

| 哪里 | 留什么 | 什么时候清 |
|---|---|---|
| Linux 包 `versions/` | `current` 之外只留 `previous` 一版，满 7 天删（`install-layout.ts` 的 `expirePrevious`） | 每次更新后；每天那次检查 |
| 桌面客户端 `<用户数据>/updates/` | 更新包装好就删；Windows 留最新 2 份安装程序、Mac 留 1 份上一版，都是 7 天（`desktop/src/updates/update-cleanup.ts`） | 启动时；每 6 小时查更新时 |
| 本机备份（数据库 + 笔记） | 最新 2 份，每份 7 天（`agent/src/state/backup-retention.ts`） | 每次备份后；每 5 分钟那次扫描 |

桌面客户端另外提供本机设备能力（Mac 的设备助手见 [mac/README.md](../mac/README.md)）。

## 设计要点

- **一个服务包**（`scripts/packages/build-server.ts`）：服务源码（Node 24 直接跑 `.ts`）、构建好的客户端、生产依赖、
  `manifest.json`（版本 = 提交时间 UTC，`年.月日.时分秒`）。源码只从提交取（`git archive`），没有原生模块和符号链接，
  各平台通用；中继按 `docs/open-source-exclusions.md` 拿掉（`exclusions.ts` 读那张表），打包前扫一遍像密钥的串。
- **服务自己发客户端**：没有 Caddy，`PLASTICINE_CLIENT_DIR` 指向 `client/dist`（`agent/src/app/static-client.ts`）。
- **安装包的服务设置**：`PLASTICINE_PLAIN_HTTP=1`（本机明文 http，会话 cookie 不带 Secure）、`PLASTICINE_DRY_RUN=0`
  （实例实际运行；Linux 想先只记不做，在 `plasticine.env` 写 1）、
  桌面客户端起本机本体时加 `PLASTICINE_STOP_ON_STDIN_EOF=1`（壳关 stdin 就收尾，壳崩了也不留孤儿）。
- **Windows 上的服务器命令**走 PowerShell（`agent/src/cloud-tools/server-shell.ts`：脚本写成 UTF-8 带 BOM 的
  `script.ps1` 再 `-File` 跑，输出改 UTF-8，超时用 `taskkill /T /F` 结束整棵进程树）；路径都经 `node:path`。

## 包里有什么、没有什么

用户数据目录里放 Plasticine 能改的东西，更新不碰：技能和技能沉淀（`skills/`）、记忆和文档、设置、心跳清单、
「怎么替你做事」等都在状态目录和库里。包里不放写 Plasticine 自己代码的开发技能（`agent/skills`）、部署和发布脚本；
维护入口 `scripts/maint.ts` 随包走：`sudo -n -u plasticine /opt/plasticine/node/bin/node /opt/plasticine/current/scripts/maint.ts …`
（`--state` 指向数据目录）。

## 怎么构建

开发和构建都用 Node 24，先在仓库根目录 `npm ci`（`desktop/` 另外 `npm ci`）。

| 环节 | 在哪跑 | 命令 |
|---|---|---|
| 服务包 | 任意 Linux / macOS | `node scripts/packages/build-server.ts --out dist/packages`（工作区要停在要打包的提交上、没有未提交的改动；可加 `--release-url <你的发布点>`） |
| Linux 端到端检查 | Linux | `node scripts/packages/linux-e2e.ts dist/packages/plasticine-server-<版本>.tar.gz` |
| 桌面客户端（Electron） | macOS / Windows | Mac 先 `bash scripts/packages/mac/fetch-node.sh <Node 版本> <输出文件>`；`node desktop/build/bundle.ts`，再 `electron-builder`（见 `desktop/README.md`） |
| 发布点清单 | 任意 | `node scripts/packages/write-release-manifest.ts …`；官方发布由构建工作流的 `github-release.ts` 整理成 GitHub Release；发到自己的目录用 `scripts/packages/publish-release.ts`、`publish-desktop.ts`（`--root`、`--base-url` 可改） |

Node 版本规范在 `agent/shared/release-manifest.ts` 的 `PACKAGE_NODE_VERSION`，脚本入口重导出；工作流里写死的
字面量由测试核对，改版本时一起改。

### 发布点

- 发布脚本把这一版拷进 `<根>/<版本>/`，再换根上的 `install.sh` 和 `manifest.json`（清单最后换，换了已装的实例才看到）。
  同一版必须有相同源码提交和包信息，原样重试保留原发布时间；较旧版本不能把根清单指回去，旧版本目录不删。
- 发布后公网 `manifest.json` 必须返回合法清单，且版本、提交、文件信息和发布时间与本次落盘完全一致；不一致就失败，
  原样重试，不删旧包。
- 发布点按静态目录发：`<版本>/` 下的文件可以缓存一年（immutable），`manifest.json` 和 `install.sh` 每次重新问（no-cache）。
- 服务包的 `manifest.json` 记着发布点（`releaseUrl`），公开 catalog 路径的更新器按它查；`install.sh` 的默认也是它。

## 尚需实机核对

- 网络（Cyber Hunter 中继）和隧道（`agent/src/network/`）在 Linux 和桌面客户端上各要真机验一次：加入网络以后
  `<handle>.cyberhunter.top` 能从手机打开。桌面客户端的其余真机项见 `desktop/README.md`。
