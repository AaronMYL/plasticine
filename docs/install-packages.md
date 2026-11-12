# 安装包：Linux / Mac / Windows

三个安装包让用户各自在 Linux VPS、Mac 或 Windows 上运行自己的 Plasticine 实例。这是 2026-11-05 已定的分发方式。
三个包装的是同一个服务包，服务只听 `127.0.0.1:8790`；网页是正式端，手机也通过网页访问自己的实例。

## 下载入口

官方发布点是 `https://cyberhunter.top/download`。实际文件地址来自
[`manifest.json`](https://cyberhunter.top/download/manifest.json)：Mac 取 `assets.mac.url`，Windows 取
`assets.windows.url`，Linux 安装器取 `assets.linuxInstaller.url`，服务包取 `assets.server.url`。
清单同时给出版本、源码提交、每个文件的 SHA-256 和大小。自己打的包可以用 `--release-url`（构建服务包时）
换成自己的发布点。

## 怎么装、怎么更新、怎么卸载

以下是统一安装包的使用方式。实际可用版本以发布点的 `manifest.json` 为准。

| | Linux（VPS） | Mac | Windows |
|---|---|---|---|
| 装 | `curl -fsSL https://cyberhunter.top/download/install.sh \| sudo sh` | 下载 `Plasticine-mac-<版本>.zip`，解开拖进「应用程序」，打开 | 下载 `Plasticine-Setup-<版本>.exe` 运行；没签名，SmartScreen 提示时选「更多信息 → 仍要运行」 |
| 打开 | 装完打印一条建账号链接（见下）；没图形界面先在自己电脑上 `ssh -L 8790:127.0.0.1:8790 <用户>@<VPS>`，再用浏览器打开它 | App 窗口直接就是（设置里「服务器」是「这台 Mac」） | 托盘图标「打开 Plasticine」，用默认浏览器（Edge / Chrome）打开 |
| 账号 | 第一次用建账号链接起名字、@账号和密码；以后别的设备用 @账号 + 密码登录；忘了密码 `plasticine password` | 本机由客户端直接登录，不问密码 | 同 Mac |
| 更新 | 自动：开机后两分钟、之后每天（`plasticine-update.timer`）；马上查：`sudo plasticine update` | 自动：启动时、每 6 小时；菜单「检查更新」 | 自动：启动后一分钟、之后每天 |
| 回到上一版 | `sudo plasticine rollback` | 菜单「回到上一版」 | 托盘「回到上一版」 |
| 卸载 | 重跑安装脚本并传 `--uninstall`，数据保留；`--purge` 会连同实例数据删除 | 退出 App，删掉 App；数据在 `~/Library/Application Support/Plasticine` | 「设置 → 应用」里卸载；最后会问要不要连数据一起删（默认不删） |
| 程序 | `/opt/plasticine`（`versions/<版本>`，`current`、`previous` 指针，`node/`） | `Plasticine.app`（带 `Contents/MacOS/node` 和 `Contents/Resources/server`） | `%LOCALAPPDATA%\Programs\Plasticine` |
| 数据 | `/var/lib/plasticine/state`（`plasticine` 用户），设置 `/etc/plasticine/plasticine.env` | `~/Library/Application Support/Plasticine/server`，日志 `~/Library/Logs/Plasticine` | `%LOCALAPPDATA%\Plasticine`（`state`、`logs`、`installers`） |

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
- Mac / Windows 和新的桌面客户端：壳启动本体时给一个本机令牌（环境变量 `PLASTICINE_LOCAL_TOKEN`），本机界面凭它建账号、
  直接登录、重设密码；只认 `127.0.0.1` 直连来的请求。服务器上不设这个变量，也就不认。
- 别的设备（手机、另一台电脑）：@账号或地址 + 密码登录。输错按来源和全局限流。
- 忘了密码：服务器上 `plasticine password`（输两遍、不回显；脚本里 `plasticine password --stdin` 读一行），本机实例在
  桌面客户端里直接重设。已经登录着的设备照旧。
- 老实例（有登录着的设备、还没设密码）照常用，登录着时设一次密码。旧的配对码脚本 `pairing-cli.ts` 还在，但登录页
  不再收配对码。

Linux、Windows 和带 bundled server manifest 的 Mac 读发布点的 `manifest.json`；Mac 不随当前连接本机或远端而切换更新来源。
版本比装着的新才下载，核对 SHA-256 和大小再换上。
Linux 换的是 `current` 指针，不健康自动换回 `previous`，那一版记下不再自动装；Windows 运行新版的安装程序，新托盘起来后
一分半没答上健康检查就装回上一版；Mac 换 App 的 Contents（沿用原来的自更新，重签后再换），上一版留在
`~/Library/Application Support/Plasticine/上一版`。

Mac 原生 App 另外提供本机设备能力，见 [mac/README.md](../mac/README.md)。Windows 托盘负责看护本机服务、打开浏览器和
更新；三个安装包拥有相同的服务基础，不代表三种操作系统已有完全相同的原生设备能力。

### Mac 两种更新来源与版本对照

| 安装形态 | 更新清单 | 判新旧的基准 |
|---|---|---|
| App 自带 bundled server manifest，连接本机或远端都一样 | 公开 `manifest.json` 的 `assets.mac` | App 内服务清单的 `年.月日.时分秒` 版本 |
| 没有 bundled manifest 的旧安装 | 已配对服务器的 `v2/nodes/mac/latest` | Info.plist 的 App 版本，例如 `0.7.3` |

两条路径共用严格数字版本比较、SHA-256 和 HTTPS 校验；公开清单还核对 schema、40 位源码提交和服务版本格式。
原有远端路径继续要求下载同源，以免把节点凭据交给其他站点。App 的运行模式不在本次整理中迁移。

最终 ZIP 的 `Info.plist`、内置服务清单、提交、发布点、大小和 SHA-256 形成构建身份文件 `mac-package.json`，随 Actions
artifact 传递。统一发布器验证同批服务包和这份身份，再将公开目录中同一个 ZIP 写到旧节点兼容入口。旧安装先用 App
版本升级到桥包，随后按公开时间版本更新；保留原运行实例配置。

兼容 latest 带明确的 `bridge` 记录。之后公开日期版本更大但 App 版本没变时，可以保留已验证的旧桥，回执明确写
`retained` 并保留旧桥自己的来源。没有标记的普通旧包、同提交不同 ZIP、坏 latest 和字节冲突均拒绝。

## 设计要点

- **一个服务包**（`scripts/packages/build-server.ts`）：服务源码（Node 24 直接跑 `.ts`）、构建好的客户端、生产依赖、
  `manifest.json`（版本 = 提交时间 UTC，`年.月日.时分秒`）。源码只从提交取（`git archive`），没有原生模块和符号链接，
  三个平台通用；中继按 `docs/open-source-exclusions.md` 拿掉（`exclusions.ts` 读那张表），打包前扫一遍像密钥的串。
- **服务自己发客户端**：没有 Caddy，`PLASTICINE_CLIENT_DIR` 指向 `client/dist`（`agent/src/app/static-client.ts`）。
- **安装包的服务设置**：`PLASTICINE_PLAIN_HTTP=1`（本机明文 http，会话 cookie 不带 Secure）、`PLASTICINE_DRY_RUN=0`
  （实例实际运行；Linux 想先只记不做，在 `plasticine.env` 写 1）、
  Mac / Windows 加 `PLASTICINE_STOP_ON_STDIN_EOF=1`（看护进程关 stdin 就收尾，看护进程崩了也不留孤儿）。
- **Windows 上的服务器命令**走 PowerShell（`agent/src/cloud-tools/server-shell.ts`：脚本写成 UTF-8 带 BOM 的
  `script.ps1` 再 `-File` 跑，输出改 UTF-8，超时用 `taskkill /T /F` 结束整棵进程树）；路径都经 `node:path`。
- **Windows 托盘**是 C# WinForms（`scripts/packages/windows/tray/`）：.NET Framework 4.x 和它的 `csc` 每台 Windows 都自带，
  `NotifyIcon` 最成熟，不加任何依赖；Node 的托盘包要么带额外的原生二进制、要么没人维护。安装程序用 Inno Setup
  （可脚本化，`windows-latest` 上 `ISCC` 一条命令）。
- **Mac** 默认模式：新装（App 带服务、以前没跑过）是「这台 Mac」；以前装过的保持「远程地址」，照旧连原来的服务器。
  细节见 `mac/README.md`「自带服务」。

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
| Mac App | macOS（要 `lipo`、Swift） | `bash scripts/packages/mac/fetch-node.sh <Node 版本> <输出文件>`，再 `bash mac/build.sh --server <服务包> --node <node>`；`python3 scripts/packages/mac/package-identity.py` 从最终 ZIP 读出身份 |
| Windows 安装程序 | Windows | `pwsh scripts/packages/windows/build.ps1 -ServerTarball <服务包> -Out dist\packages`，`smoke.ps1` 做安装 / 升级 / 卸载检查 |
| 桌面客户端（Electron） | macOS / Windows | `node desktop/build/bundle.ts`，再 `electron-builder`（见 `desktop/README.md`） |
| 发布点清单 | 任意 | `node scripts/packages/write-release-manifest.ts …`；发到自己的目录用 `scripts/packages/publish-release.ts`、`publish-desktop.ts`、`publish-packages.ts`（`--root`、`--base-url` 可改） |

Node 版本规范在 `agent/shared/release-manifest.ts` 的 `PACKAGE_NODE_VERSION`，脚本入口重导出；平台脚本里保留的
字面量由测试核对，改版本时一起改。

### 发布点

- 发布脚本把这一版拷进 `<根>/<版本>/`，再换根上的 `install.sh` 和 `manifest.json`（清单最后换，换了已装的实例才看到）。
  同一版必须有相同源码提交和四包信息，原样重试保留原发布时间；较旧版本不能把根清单指回去，旧版本目录不删。
- 发布后公网 `manifest.json` 必须返回合法清单，且版本、提交、文件信息和发布时间与本次落盘完全一致；不一致就失败，
  原样重试，不删旧包。
- 公网验证后才使用公开目录内的同一 ZIP 更新旧 Mac 桥包；每个阶段有结构化回执。公开已写而后续失败为 `partial`，
  不回滚公开版本。
- 发布点按静态目录发：`<版本>/` 下的文件可以缓存一年（immutable），`manifest.json` 和 `install.sh` 每次重新问（no-cache）。
- 服务包的 `manifest.json` 记着发布点（`releaseUrl`），公开 catalog 路径的更新器按它查；`install.sh` 的默认也是它。

## 尚需实机核对

- 网络（Cyber Hunter 中继）和隧道（`agent/src/network/`）三个包各要在真机上验一次：加入网络以后
  `<handle>.cyberhunter.top` 能从手机打开。
- Mac「这台 Mac」模式的节点配对认 `http://127.0.0.1`（`ServerAddress.pairable`）。本机节点配对与旧安装的实际升级
  需要实机确认。
