# Plasticine 桌面客户端（Electron 壳）

Mac 和 Windows 共用这一套壳。自己的窗口、应用内浏览器（竖排标签由界面管、壳管
视图）、问这一页、翻译、系统通知、「这台电脑 / 远程」切换、自动更新、设备服务都在这里写一遍；截屏、点按、文件、
命令、Apple 日历和提醒事项交给各系统的助手进程（协议在 `agent/shared/desktop-helper-protocol.ts`）。

## 目录

| 位置 | 做什么 |
| --- | --- |
| `src/app/` | 主进程入口 `main.ts`、主窗口、界面 preload（只暴露 `window.plasticineDesktop`）、ipc 认人和校验、本体跑在哪与本机本体看护（本机令牌）、本机自动登录和探远程地址（`account-client.ts`）、@账号 / 地址解析、等 OAuth 回调、设置、菜单托盘 |
| `src/pages/` | 开始页（`start.html` + `start.ts`，打成 `dist/start.js`）：二选一、连到我的 Plasticine、正在打开、没起来 |
| `src/tabs/` | 网页标签：每个标签一个 WebContentsView、叠在界面上面或垫到下面（`tab-layering.ts`）、标签 preload（翻译、圈一块、问这一页、DOM 动作，脚本是 `client/src/mac/` 那几份原样打进来）、调试协议（整页截图、可信点击）、网站图标、设备动作 `tab_*` |
| `src/node/` | 设备服务：配对、hello、长轮询、回执接续、设备上限、授权目录、凭证（safeStorage） |
| `src/helper/` | 拉起系统助手（协议和调用器在 `agent/shared/desktop-helper-*`） |
| `src/logins/` | 网站登录：列、退出、从 Chrome 搬一次（Mac 读「Chrome Safe Storage」，Windows 用 DPAPI） |
| `src/feeds/` | 信息流要这台电脑做的：X「关注」时间线、抖音收藏和下载地址（看不见的窗口里用用户自己的登录取） |
| `src/updates/` | 自更新（`desktop.json`）、坏版本退回、Mac 本机证书重签 |
| `helpers/windows/` | Windows 助手（C#） |
| `build/` | `bundle.ts`（esbuild 打成 `dist/`）、`smoke.ts`（Linux xvfb 冒烟） |
| `electron-builder.json`、`build-resources/` | 打包：Mac dmg + zip（通用二进制、临时签名），Windows NSIS（不签名） |

界面和壳之间的接口：`agent/shared/api/desktop-bridge.ts`（`PlasticineDesktopBridge`），网页标签、窗口外观、翻译、登录
沿用 `mac-bridge.ts`、`mac-translate.ts`、`mac-logins.ts`、`web-page-tools.ts` 的形状。壳 → 界面的事件：
`__plasticineWebTabEvent`（state / opened / operate，以及新的 `icon`：`{ type: 'icon', tabId, pageUrl, icon: 'data:image/…' }`，
图标最多 64 KB）、`__plasticineTranslateEvent`、`__plasticineWindowChrome`（Windows 上带 `controlsRight`，右上角窗口按钮的
实际宽度）、`__plasticineWebMenu`、`__plasticineNativePointer`、`__plasticineDesktopEvent`（server / update / device 状态）。

## 开发

```sh
export PATH=/opt/node24/bin:$PATH
npm ci                                  # 仓库根（本体、界面、共享 schema）
cd desktop && npm ci                    # electron、electron-builder、esbuild
npx install-electron                    # Electron 45 起 npm ci 不自动下二进制；打包不需要，跑起来要
npm run typecheck && npm test           # 纯逻辑的测试不要 Electron（根目录 npm test 也跑 desktop/tests）
PLASTICINE_DESKTOP_URL=http://127.0.0.1:5173/ npm start   # 指到假接口的界面（client 里 npx vite），不起本机本体
npm run smoke                           # Linux：xvfb 里打开壳、开网页标签、注入翻译，再走一遍首次使用流程，截图到临时目录
```

开发时可以用的环境变量：`PLASTICINE_DESKTOP_URL`（直接载入这个界面）、`PLASTICINE_DESKTOP_SERVER` / `_NODE` /
`_HELPER`（本体、Node、助手放在别处）、`PLASTICINE_DESKTOP_USER_DATA`（Electron 数据目录）、
`PLASTICINE_DESKTOP_RELEASE_URL`（换发布点）。

## 打包和发布

随安装包一起构建（见 `docs/install-packages.md`），三步：

- `desktop-mac`（macos-15）：解开服务包到 `stage/server`、`fetch-node.sh` 出通用 Node、`swift build --arch arm64
  --arch x86_64 --product plasticine-helper` 出通用助手 → `bundle.ts` → `electron-builder --mac`（版本号去掉前导零，
  文件名用发布版本号）→ 打开 App 等本机本体答上、问一次助手。
- `desktop-windows`：Node、`helpers/windows/build.ps1` 编助手、`smoke.ps1` 冒烟、图标 → `electron-builder --win` →
  静默装、等本机本体答上。
- `desktop-release`（发布时，服务包发好之后）：`scripts/packages/publish-desktop.ts` 把桌面包放进同一个版本目录，换
  `desktop.json`（不碰 `manifest.json`：已装的 Linux 更新器、旧 Mac App、托盘按严格 schema 读它）。

桌面包失败不挡服务包的发布。旧的 Swift Mac App 不读 `desktop.json`，不会被换成 Electron 版（第 18 条：手动装一次）。

## 第一次打开（11-08 首次使用流程）

- 没选过（没有设置文件，或 11-08 那一版自动默认成这台电脑、没记「选过」的）就停在开始页二选一，不替用户选、不起本体。
  Swift 版存的远程地址只当「连到我的 Plasticine」那一格的预填。
- 「在这台电脑上」：存下、起本机本体（开始页显示正在打开）；起来后问 `GET /v2/account/state`：`needed` 载入
  `127.0.0.1:8790/#/setup` 建账号；`done` 由主进程带本机令牌 `POST /v2/session/local`，把 Set-Cookie 写进界面视图的
  session 再载入，用户看不到登录页（会话还有效就不再登记一次设备）。本体还没有账号接口时照旧载入首页。
- 「连到我的 Plasticine」：一格「@账号或地址」（`@handle`、`handle`、`handle.cyberhunter.top`、`https://…` 都认，不带点的
  当 @账号）；「连上」先探 `<地址>/v2/account/state`（旧版本体 404 时看 `/v2/health`），到不了就地一行原因，到了存下并载入
  `<地址>/#/login`。远程没地址时回开始页，不再悄悄回落本机。
- 换地方：菜单「Plasticine → 连接到…」、Windows 托盘「连接到…」、界面里的「换一个地方」（`server.showWelcome()`）都回开始页，
  现在用的那一个描着边；本机本体照跑，选了别的才停。「设置…」没登录时也回开始页。
- 本机令牌：每次拉起本体用 `crypto.randomBytes(32)` 生成，只经环境变量 `PLASTICINE_LOCAL_TOKEN` 给本体，不写盘、不进日志；
  `server.localGrant()` 只在界面载入的是本机本体（同源 `127.0.0.1:8790`）时给，否则 null。忘了密码：选这台电脑时菜单 /
  托盘有「重设密码…」，打开 设置 · 账号，凭本机令牌不问旧密码。
- `external.open(url)` 只收 http(s)、交给系统浏览器；`external.capture(port, timeoutMs)` 在 `127.0.0.1:port` 听一次 OAuth
  回调，回完整地址（`http://localhost:port/…`），浏览器看到「已完成」；超时、取消、端口被占回 null，同一时间只有一个。

## 自更新

每 6 小时查 `https://cyberhunter.top/download/desktop.json`，有新版就下载、核对 SHA-256 和大小，下好了发系统通知、
设置 · 系统「客户端」那一行显示，用户点「重新打开」才换：

- Mac：解开 zip → 用本机证书「Plasticine Local Signing」重签 → 客户端退出后脚本只换 `Plasticine.app/Contents`
  （文件夹不动，Dock 上固定的图标照旧能用，0.7.1 修过的问题）→ 重新打开。旧的 Contents 进「上一版」。
- Windows：静默跑新的安装程序（`/S --updated --force-run`），留着这一版的安装程序当「上一版」。
- 坏版本退回：新版 90 秒内没把主窗口载入完（没写下 `started-<版本>`），脚本结束它、换回上一版，记下这一版不再自动装
  （和 Linux 包 `updater.ts` 的健康检查同一个意思）。设置里另有「退回上一版」。

## 钥匙串（Mac）

照默认用钥匙串：网站数据（Cookie）由 Chromium 用「Plasticine Safe Storage」加密，配对凭证用 safeStorage 加密。
为了尽量只弹一次，第一次打开时客户端先把自己换成本机证书签的那一份再碰钥匙串（`updates/adopt-signing.ts`），以后每个
版本都用同一张证书签，签名身份固定。系统问能不能用证书私钥、能不能读「Plasticine Safe Storage」时点「始终允许」。
固定不住也照样用钥匙串，不退回明文。

## 第一次手动安装

**Mac**

1. 先退出旧的 Plasticine（菜单栏「退出」）。
2. 打开 `https://cyberhunter.top/download/` 下的 `Plasticine-Desktop-mac-<版本>.dmg`，把 Plasticine 拖进「应用程序」，
   选「替换」。
3. 第一次打开：右键「打开」（临时签名，系统会提示来源）。客户端会自己换成本机证书签的那一份并重新打开一次：钥匙串问
   「codesign 想用 Plasticine Local Signing」点「始终允许」；之后问「Plasticine Safe Storage」也点「始终允许」。
4. 打开后先问「在哪里用 Plasticine？」：
   - 用服务器上那份：点「连到我的 Plasticine」，填 `@账号`（或地址，Swift 版用过的地址已经预填），「连上」，再用 @账号 +
     密码登录。已经登录着的设备照常用；还没设过密码时，在已登录的设备上会弹一次「给 @账号设一个密码」。
   - 在这台 Mac 上新起一份：点「在这台电脑上」，等它起来，填名字、@账号、密码建账号（一步）。以后打开由客户端自动登录，
     不问密码。
   选错了：菜单「Plasticine → 连接到…」回到这一页。
5. 网站登录要重新登录或在设置里「从 Chrome 导入」（Swift 版的 WebKit 登录搬不过来）。
6. 设置 · 系统：屏幕录制、辅助功能、日历、提醒事项都要重新给一次（新的签名身份）。

**Windows**

1. 下载 `Plasticine-Desktop-Setup-<版本>.exe`，双击；SmartScreen 拦下时点「更多信息 → 仍要运行」。
2. 安装程序会先停掉旧的托盘版、静默卸掉它（数据 `%LOCALAPPDATA%\Plasticine\state` 留着，接着用），再装新的。
3. 打开后同样先二选一。接着用托盘版留下的数据就点「在这台电脑上」：已经有主人的直接自动登录进去，还没有的先建账号。
   换地方在托盘菜单「连接到…」。
4. 关窗口只是藏起来，托盘里还在，本机的 Plasticine 照样跑；要停在托盘里点「退出」。

## 在真机上要验的（Linux 上验不了）

1. Mac：交通灯在顶栏里竖直居中、左边距 20；顶栏空白处能拖窗口、双击缩放；按钮不拖。Windows：右上角窗口按钮在顶栏里，
   界面让出 `controlsRight` 那么宽。
2. 对话框盖在网页标签上时：网页照常看得见；浮层外点网页、拖选、滚动、右键都给网页（经 sendInputEvent 转过去），光标跟着
   网页换；浮层里的点给界面。
3. 第一次打开（删掉 `Plasticine/Desktop/settings.json` 再开）：停在二选一，本机本体没起；Mac 卡片写「合上盖子就停」，
   Windows 写「关机就停」，右上角窗口按钮不压内容；跟随系统深浅色。
4. 「在这台电脑上」→ 建账号 → 退出再打开：直接进主界面，不见登录页；「重设密码…」打开 设置 · 账号，不问旧密码。
5. 「连到我的 Plasticine」填 `@账号`：到不了时就地一行原因；到了进登录页，@账号 + 密码登录。菜单 / 托盘「连接到…」、
   登录页「换一个地方」回开始页，现在用的那一个描着边。
6. 模型订阅登录：系统浏览器打开，登录完浏览器显示「已完成」，界面接上（连远程实例时也一样）。
7. 「这台电脑 / 远程」在设置 · 系统里切换：窗口换地址，本机本体起停，数据不搬。
8. 系统通知点开到对应页；关通知开关后不弹。
9. 从 Chrome 导入登录（Mac 弹「Chrome Safe Storage」授权；Windows 上 Chrome 127 起的 v20 加密 Cookie 解不开，会如实计入
   「跳过」）。
10. 设备服务：配对、hello 的能力随系统权限变化、截屏和点按、文件读写、命令、删除弹确认、付款页关死。
11. 自更新：发两版，第二版装上后 Dock 图标照旧能点开；故意发一个起不来的版本，90 秒后自动退回。
12. Mac 第一次打开换成本机证书签名、只问那两次钥匙串。
