# Plasticine Mac

原生壳和设备服务位于同一个 App 进程。最低 macOS 14，使用 Swift Package、系统框架和 Command Line Tools，
不需要完整 Xcode、Homebrew、第三方 Swift 包或 Xcode 工程。Swift 语言模式固定为 5，兼容较新 SDK。

## 构建与验证入口

在 macOS 上从 `mac/` 目录构建和测试：

```sh
swift build && swift test
bash build.sh [--server <服务包.tar.gz> --node <node 可执行文件>]
```

安装包（三平台）的构建见 [安装包说明](../docs/install-packages.md)。

`build.sh` 产出 `mac/build/Plasticine.app`，依次 release build、生成 PNG 图标、`iconutil` 转 ICNS、组装 bundle、
执行 `codesign --force --deep -s -` 并验证签名。图标中间文件放系统临时目录；内部脚本不构成另一套正式构建或发布入口。

从打包后的 `.app` 启动，通知、钥匙串、登录项和系统隐私权限才有稳定的 bundle 身份。
`swift build` 只验证可执行文件；不要用 `swift run` 代替 App 的运行验收。
如果 `swift test` 报系统缺少 XCTest 或 SDK，请把完整报错发回，先核对 Command Line Tools 版本及 SDK 路径。

## 自带服务（安装包，「这台 Mac」）

给朋友装的 Mac App 自己带一份 Plasticine 服务（docs/install-packages.md）：`Contents/MacOS/node`（通用二进制）
和 `Contents/Resources/server`（服务包解开）。CI 先构建服务包、下载并核对两种芯片的 Node，再把它们作为
`build.sh` 的 `--server` 与 `--node` 参数传入。没有 bundled server 的旧 App 仍只连接远程。

- 设置里「服务器」选「这台 Mac」或「远程地址」。新装（带服务、以前没跑过）默认这台 Mac；以前装过的（有设置或
  `~/Library/Application Support/Plasticine`）保持远程，照旧连原来的远程地址。
- 这台 Mac：`local-server.swift` 用带的 Node 起服务（127.0.0.1:8790，数据 `~/Library/Application Support/Plasticine/server`，
  日志 `~/Library/Logs/Plasticine/server.log`），崩了按 1–30 秒退避重启；退出 App 时关 stdin + SIGTERM，4 秒后 SIGKILL。
  窗口等服务答上 `/v2/health` 再载入。会话 cookie 不带 Secure（`PLASTICINE_PLAIN_HTTP=1`，WebKit 不收明文下的 Secure）。
- 带 bundled server manifest 的 App 自更新读发布点的 `manifest.json`（`release-update.swift`），比的是内置服务包版本，
  包是 `assets.mac`；连接本机或远端都使用这条来源。下载核对 SHA-256 和大小以后沿用下面的重签、只换 Contents。
  「上一版」保留，菜单「回到上一版」可一步回退。没有 bundled manifest 的旧安装才读服务器的 `/v2/nodes/mac/latest`。
- 这台 Mac 模式下节点配对认本机服务 `http://127.0.0.1:8790`（`ServerAddress.pairable`）；远程只认 HTTPS。

## 使用及权限

1. 新装且带服务的 App 默认打开这台 Mac 的本机实例；已有安装保留原运行模式和远程地址，旧远程默认地址为
   `https://203.0.113.10/`。远程网页按设备配对流程登录；默认 WebKit 数据存储保留 cookie。
2. 菜单栏「配对这台 Mac…」使用网页「设置 → 系统 → 设备 → 添加设备 → 连接 Mac 执行节点」生成的 Mac 专用码。
   节点凭证存在 App 自己的受保护文件 `~/Library/Application Support/Plasticine/node-credential/`（目录 0700、文件 0600，
   按 HTTPS 服务器源地址的 SHA-256 分开，原子写入），不用钥匙串（0.7.0 起，他 2026-11-05 定：钥匙串认签名，每次更新都弹框）。
   0.6.0 及以前存在钥匙串（service `com.plasticine.app.node`）：文件里没有时读一次旧项搬进文件，之后不再碰；旧项不删。
3. `⌥Space` 显示窗口并聚焦对话；`⌘,` 打开设置，点快捷键框后按新组合，或恢复默认值。
4. 关主窗口只隐藏；Dock 点击重新显示。菜单栏可暂停设备服务，退出 App 会停止服务并保存本轮回执。
   退出时最多等设备服务收尾 5 秒，再点一次退出立刻退；开始退出 10 秒后进程还在就直接结束（0.7.0，更新后旧版关不掉）。
   启动时结束同一 bundle id、比自己先启动的旧实例（先发退出，3 秒后还在就强制结束，连同它开的命令子进程），
   再占快捷键、起设备服务（`app-instances.swift`）。
5. 把文件拖到 Dock 图标，或「打开方式 → Plasticine」：每次最多 5 个、每个最多 10 MiB。
   网页沿用现有附件类型支持（PNG、JPEG、WebP、文本、PDF），不支持的类型在输入框旁说明。
6. 下载保存到 `~/Downloads`，同名文件自动加后缀。网页选择文件使用系统面板。

用户需要按用途点的系统权限：

| 用途 | 入口 |
| --- | --- |
| 截图 | 设置里的「屏幕录制 → 去打开」，在系统「隐私与安全性 → 屏幕与系统音频录制」允许 Plasticine |
| 点击、输入 | 「辅助功能 → 去打开」，在系统「辅助功能」允许 Plasticine |
| 通知 | 第一次网页调用 `notify` 时弹系统请求；也可从设置里打开通知权限 |
| 登录时启动 | 菜单栏勾选；系统要求批准时会打开登录项设置 |
| 家目录里的受系统保护文件夹 | 首次访问桌面、文稿、下载等目录时按系统提示允许；本地目录授权不替代系统权限 |

快捷键用 Carbon，不需要辅助功能权限。没有屏幕录制权限就不报 `screen_capture`，没有辅助功能权限就不报
`input_click` / `input_type`；下次 hello 更新能力。系统有时要求退出重开 App 才识别新权限。
Info.plist 包含 Apple Events 中文用途说明；当前打开应用用 NSWorkspace，不主动请求 Apple Events 权限。

## 节点协议和动作

服务器地址只接受 HTTPS 源地址，可带端口，不带用户名、密码、路径、查询或片段。证书走系统正常验证。
如默认 IP 的证书不被系统信任，需要在 Mac 上处理证书或改用具有有效证书的服务器地址。
WebView 的登录 cookie 与节点的 Bearer 通道分开，节点 API 不跟随 HTTP 重定向。

配对、hello 字段对照 `agent/shared/api/devices.ts` / `agent/shared/state-devices.ts`。
长轮询严格采用本任务协议（不是基线里的旧 NodeActionEnvelope / NodeActionReport）：

```text
POST /v2/nodes/pair
POST /v2/nodes/hello                         启动时及每 60 秒
GET  /v2/nodes/actions/next?wait=25           204 或 { action: { id, kind, params, deadline } }
POST /v2/nodes/actions/<id>/result           { status, result?, error?, refusalLayer?: "device" }
```

`params` 包含共享 schema 的 `kind` 判别字段，必须与外层 `kind` 一致；`deadline` 为 ISO 8601 时间。
配对重试保留同一输入码的 requestId。401 停止服务并显示「需要重新配对」。网络错误按 1、2、4、8、16、32 秒退避。
hello 独立于动作执行；每轮先上传未确认回执，再领取动作。同一个动作 id 只执行一次。
每次 hello 还上报 `idleSeconds`（用户最近一次键鼠活动距今的秒数，取键盘 / 移动 / 点击里最近的一次，封顶十天）；
用户在用时服务端让点击 / 输入等着，不和用户抢。

动作开始前原子保存记录，完成后原子保存结果；结果上传失败只重传原结果。记录位于
`~/Library/Application Support/Plasticine/actions/`，按服务器和节点分开，无节点凭证。
记录包含这次动作的结果正文；目前保留已上传记录用于去重，不自动清理。
如果 App 在执行中被强制结束，下次启动报告「结果待核实」，不再次运行那个动作。

本机目录默认整个家目录，可在「授权目录…」增删，空列表表示不授权文件和工作目录。
还会检查 hello 返回的用户设备上限（目录、应用、站点、动作类、次数、逐次确认、无人操作、付款），不写云端用户确认字段。
上限里多出的未知键（如 `payments`）不影响解码。设备侧是最后一道墙（第 102 条）：按服务端同样的规则判道，判不准从严——
付款 / 下单 / 转账默认关死（`payments` 缺省或 `deny` 时直接拒；只有签名放开成 `confirm_each` 才降为弹一次确认）；
读钥匙串 / `~/.ssh` / 浏览器密码库、`security find-*-password`、`sudo`、`defaults write`、`systemsetup`、`tccutil`、
`spctl` 等命令，打开或在「系统设置」里点击，都弹一次原生确认（沿用删除的确认做法）。
云端的 roots/apps/sites 为空列表表示云端不另加限制（第 97 条），只按本机授权目录；云端设了清单才按清单再限一层。
长轮询下发的 `params` 不含 `kind`（它在外层），解码前由 App 补回。
路径展开 `~`，解析包括悬空链接在内的符号链接，并按目录边界判断。

- 读文件最多 10 MiB，版本为原始字节的 SHA-256；UTF-8 无效时返回 base64。
- 写入内容是 UTF-8；`baseVersion: null` 只允许创建新文件，已有文件必须给出匹配版本，原子写入。
  回执里的 `version` 是写完后重新读磁盘字节算的 SHA-256（不用输入缓冲），证明磁盘上真实的内容。
- 删除每次弹「删除 / 不删」，默认回车选择不删，通过后移至废纸篓。
- 命令经 `/bin/zsh -lc` 执行。工作目录须获授权；stdout、stderr 各限 100 KiB，仍持续排空管道。
  超时 120 秒或暂停会终止该命令的进程组；命令自行脱离进程组启动的服务不属于这个组。
  工作目录检查不构成 shell 沙箱。
- `browser_read` 是 URLSession 读取的 HTTP 文本（HTML 保留标记），不是已登录浏览器的 DOM，最多 200 KiB。
  要读用户登录着的页面用下面的 `tab_*`。
- 网页标签动作（0.2.0 起，第 102 条第 3 批）在 Plasticine 窗口的网页标签里按 DOM 做，不动真鼠标、不要辅助功能权限：
  `tab_list`（标签标识、地址、标题、哪个在前、用户正看着哪个）、`tab_read`（`offset` 起最多 12 000 字正文；
  第一段另带最多 40 个链接、30 个表单字段，密码框的值从不回传）、`tab_open`（后台开新标签，不抢用户正看着的）、
  `tab_navigate`、`tab_click`（CSS 选择器或看得见的字，恰好一项）、`tab_fill`（输入框、文本框、下拉框、勾选框、
  可编辑区域，用原生 setter 再发 input / change，React 这类页面也认）。脚本跑在独立脚本世界（`.defaultClient`）里，
  页面自己的脚本碰不到。完成证明：开 / 换地址读回载入完成和最终地址；点之前和之后各读一次页面（地址、标题、正文和
  被点元素的状态）算 SHA-256，`changed` 为真才算点到；填完读回值，`matches` 为真才算填对。
  判道两次：先按参数（和服务端 lanes.ts 同一套：付款页、付款按钮、卡号、卡号框关死，密码框要你点），找到元素后
  再按它的真实 DOM（页面地址、表单提交地址、按钮上的字、autocomplete、表单里有没有密码框）判一次，判不准从严。
  用户正看着这个标签（Plasticine 窗口在前、它在中间区、30 秒内动过键鼠）时点和填不做，回 `failed` +
  `errorCode: 'user_present'`，服务端让任务等用户停下来，不算失败。
- 截图使用主显示器，长边最多 1600；点击坐标基于本次 App 运行里最近成功截图，转换为全局屏幕点。
  点击坐标依据的截图已失效（显示器变化、App 重启后）回 `status: failed, errorCode: 'screenshot_stale'`，服务端自动重截再定位。
  `input_click` / `input_type` 做完后再截一张，回执带 `afterShot: { sha256, width, height, capturedAt, beforeSha256? }`
  和 `changed`（前后画面在设备侧按阈值比对，原图不进回执）；没有屏幕录制权限时点击照做，只是回执不带 `afterShot`、不算证明。
  输入支持 Unicode；应用可按名称或 bundle id 打开。

## 自签证书与自更新

Mac 用本机生成的自签代码签名证书签名、自己更新（第 102 条，只自用，不开付费开发者账号）。

- 首次需要重签时在登录钥匙串生成一张「Plasticine Local Signing」自签证书（`openssl` 造私钥 + codeSigning 证书，
  `security import` 进登录钥匙串并把 `/usr/bin/codesign` 加进私钥使用许可），之后所有更新都用它
  `codesign --force --deep -s` 重签，签名身份固定——更新后屏幕录制 / 辅助功能权限不丢。
  第一次用这张证书重签时系统会弹一次钥匙串访问，请选「始终允许」。私钥、证书、一次性口令只在临时目录里，用完即删。
- 菜单栏「检查更新」可手动查；App 每 6 小时自动查一次。有设备动作正在执行时不替换。
- 替换流程：从对应更新来源下载 zip（校验 SHA-256，公开 catalog 另核大小）→ 解压 → 用本机证书重签 → `codesign --verify` →
  只换包里的 `Contents`：旧的 `Contents` 挪到 `~/Library/Application Support/Plasticine/上一版/` 备份、新的放进原来那个
  `Plasticine.app` 文件夹 → 向 LaunchServices 重新登记 → 重启自己。文件夹本身不动，Dock 上固定的图标照旧能用（0.7.1 起；
  以前整包挪走，Dock 跟着去了备份，见 `self-update-reattach.swift`，旧安装器装出来的新版启动时会把文件夹接回）。任何一步失败都保留旧版本，
  菜单与设置里显示「更新失败：原因」。带 bundled manifest 的 App 保留上一版供回退，不因切换远程连接而清除；
  没有 bundled manifest 的旧形态仍沿用旧备份清理。0.3.1 以前留在 App 旁边的 `Plasticine-backup-*.app` 清理规则另保留。

**旧安装的兼容接口**（`agent/src/app/mac-updates.ts`；带 bundled manifest 的 App 使用公开 catalog）：

| 项 | 约定 |
| --- | --- |
| 元数据 | `GET /v2/nodes/mac/latest`，`authorization: Bearer <节点凭证>` |
| 返回 | `{ "version": "0.2.0", "sha256": "<zip 字节的 64 位十六进制 SHA-256>", "url": "<下载地址>" }` |
| 下载 | `GET <url>`，带同一个节点 Bearer，返回包的 zip 字节；`url` 必须是本服务器同源的 HTTPS 地址 |
| 版本 | `version` 比 App 的 `CFBundleShortVersionString` 新（点分数字比较）才更新 |
| 包放哪 | 服务器状态目录 `downloads/mac/`：`latest.json`（`version`、`sha256`、`file`）和那个 zip；没有就回 404 |

**发布一个新包**：三平台构建与 smoke 通过后，统一 publisher（`scripts/packages/publish-packages.ts`）验证最终
Mac ZIP 身份、服务清单、提交和散列，公开清单核验成功后，将公开目录里的同一个 ZIP 写入旧安装兼容入口
（`scripts/publish-mac-update.ts`）。首个迁移桥需提高 `Resources/Info.plist` 的 App 版本和 build；后续日期版如何保留
已经核验的桥包见 [安装包说明](../docs/install-packages.md)。

## 网页桥接

注入 `window.plasticineMac = { version, notify(title, body, hash), webTabs, windowChrome }`，仅接受本站主 frame 的原生消息。
通知点击显示窗口并设置 `location.hash`。新窗口、`target=_blank` 和站外主框架链接走默认浏览器。

### 网页标签（0.2.0 起）

网页界面只画地址条；地址条下面那一块（中间区）由原生层的独立 WKWebView 画（0.3.0 起垫在主网页下面，见下一节）。
每个网页标签一个 WKWebView，
不在前的藏起来；用固定标识的持久数据存储（`WKWebsiteDataStore(forIdentifier:)`），和 Plasticine 自己页面的 cookie
分开，用户在网页标签里登录的网站留在这台 Mac 上，重开、更新后都还在。新窗口、`target=_blank` 开成新标签并切过去；
下载沿用主窗口的下载逻辑；http(s) 以外的链接交给系统（Plasticine 正在点 / 填时不跳）；页面自己 `window.close()` 就关标签；
键盘焦点在网页标签里时 ⌘R 刷新它。0.2.1 起 Plasticine 自己页面里的站外链接也开成网页标签：网页界面在 document
上统一拦截站外链接的点击（`client/src/shell/open-external.ts`），漏网的（`window.open`、表单、脚本跳转）由主窗口的
导航代理开成新标签、经 `opened` 事件交给网页界面认领并切过去；mailto: / tel: 照旧交给系统。网页版、手机和旧版 App
（没有 `webTabs`）里外链照旧跳系统浏览器。

协议（形状以 `agent/shared/api/mac-bridge.ts` 为准；只收 Plasticine 主网页、本站、主 frame 的消息）：

| 方向 | 消息 | 说明 |
| --- | --- | --- |
| 网页 → 原生 | `webTabs.sync({ tabs: [{ tabId, url }], active, frame, hitRegions? })` | 每次标签、布局、浮层变化发一整份；`frame` 是中间区的 CSS 像素矩形（相对主网页视口）；`active` 或 `frame` 为 null 就全部藏起来。`url` 只在原生层第一次见到这个标签时用来载入。`hitRegions`（0.3.0）：盖在网页上的浮层矩形，见下一节 |
| 网页 → 原生 | `webTabs.command(tabId, 'back' \| 'forward' \| 'reload' \| 'stop' \| 'open_external')` | 前进后退、刷新、停止、在系统浏览器打开 |
| 网页 → 原生 | `webTabs.navigate(tabId, url)` | 地址栏回车，只收 http(s) |
| 网页 → 原生 | `webTabs.snapshot(tabId)` → `{ tabId, url, title, text, totalChars, truncated }` | 「问这一页」：可见正文最多 10 万字，超过截断并给出总字数 |
| 原生 → 网页 | `__plasticineWebTabEvent({ type: 'state', tabId, url, title, canGoBack, canGoForward, loading })` | 地址、标题、能否前进后退变了 |
| 原生 → 网页 | `__plasticineWebTabEvent({ type: 'opened', tabId, url, title, openedBy, activate })` | 原生层开的新标签（新窗口切过去；`tab_open` 在后台）；网页认领前不会因清单里没有而被关 |
| 原生 → 网页 | `__plasticineWebTabEvent({ type: 'closed', tabId })` | 页面自己关了 |
| 原生 → 网页 | `__plasticineWebTabEvent({ type: 'icon', tabId, pageUrl, icon })` | （11-08 加，Electron 壳报，Swift 版还没报）页面的网站图标变了：`icon` 是 `data:image/…`（≤ 64 KB）；不报时网页用本体代取的 `/v2/favicon` |
| 原生 → 网页 | `__plasticineNativePointer()` | 0.7.0：按下（左 / 右 / 中键）落在网页标签上（NSEvent 本地监视器，事件照常往下传）；网页界面在 window 上发 `plasticine:native-pointer`（`client/src/mac/native-pointer.ts`），非模态浮层听它收起 |

消息走 `plasticineTabs`（`WKScriptMessageHandlerWithReply`），`sync` / `command` / `navigate` 不等回执。

### 网页工具（第 2 批「浏览器」，2026-11-04）

网页工具条 ⋯ 菜单、圈一块、标签悬停预览要原生做的几样，形状以 `agent/shared/api/web-page-tools.ts` 为准。网页界面只显示
原生报了的项（没报的不显示）。**这台写代码的机器没有 Xcode，第 2 批的 Swift 没编译过**，等 GitHub macOS 机器上
`swift build` / `swift test` 和真 App 验收。

| 方向 | 消息 | 说明 |
| --- | --- | --- |
| 原生 → 网页 | `webTabs.tools`（注入时写死的数组） | 会做的工具：find、zoom、capture、capture_full、print、circle、thumbnail、downloads |
| 网页 → 原生 | `webTabs.tool(tabId, { kind: 'find', query, backwards })` → `{ found }` | `WKWebView.find`，高亮并滚过去；`find_clear` 清掉选区 |
| 网页 → 原生 | `webTabs.tool(tabId, { kind: 'zoom', factor })` | `pageZoom`（0.5–3）；按网站记住在网页侧，换网站时网页侧再发 |
| 网页 → 原生 | `webTabs.tool(tabId, { kind: 'capture', scope })` → `{ type, base64 }` | 可见部分 `takeSnapshot`；整页 `createPDF` 画成长图（长边 ≤ 16384），JPEG ≤ 10 MB |
| 网页 → 原生 | `webTabs.tool(tabId, { kind: 'print' })` | 系统打印面板（里面能存成 PDF） |
| 网页 → 原生 | `webTabs.tool(tabId, { kind: 'circle' })` → `{ text, url, title }` / null | 独立脚本世界里跑 `circle-page-script.swift`（抄自 `client/src/mac/circle-page.ts`，测试核对一字不差）：框一块或点一个元素；Esc、`circle_cancel` 回 null |
| 网页 → 原生 | `webTabs.tool(tabId, { kind: 'thumbnail' })` → `{ type, base64 }` / null | 标签悬停预览，宽 560；截不到回 null，网页侧不放缩略图 |
| 网页 → 原生 | `webTabs.tool(tabId, { kind: 'downloads' })` | 打开「下载」文件夹 |
| 原生 → 网页 | `__plasticineWebMenu('find' \| 'print' \| 'history')` | 「网页」菜单的 ⌘F / ⌘P / ⌘Y：键盘在原生网页里时主网页收不到，由菜单交过去 |

### 交通灯并进顶栏、对话框盖在网页上（0.3.0）

设计稿 2026-11-03「需要原生配合」。都由网页界面先开口：旧网页界面不报，App 就照 0.2.x 的样子（系统标题栏、网页标签叠在上面）。

- **窗口外观**：网页第一次调 `windowChrome.titlebar({ height, noDrag })`，窗口换成 `fullSizeContentView` + 透明标题栏 +
  隐藏标题（之后不换回去，刷新不闪），交通灯左边距 20、竖直中线对齐网页顶栏中线（交通灯所在的标题栏容器撑到顶栏高，
  按钮上下留白相等）。`windowChrome.current()` 同步回 `{ trafficLightInset, fullScreen }`（CSS 像素；按钮 14 宽、间隔 6
  时是 78，全屏为 0）；进出全屏时调 `window.__plasticineWindowChrome(同样形状)`。窗口不开系统窗口标签页。
- **拖窗口**：WKWebView 不认 `-webkit-app-region`。顶栏高度以内、不落在 `noDrag` 矩形（标签、按钮、地址栏）里的点，
  由内容视图自己收下：单击 `performDrag`，双击按系统「连按标题栏」设置缩放 / 缩小 / 不动；全屏时不拖。页面换文档时
  上一份顶栏布局作废，等新页面再报。
- **网页标签垫在下面**：网页的 `sync` 带了 `hitRegions`（哪怕是空数组）就把网页标签层放到主网页下面，主网页不画底色；
  网页界面在网页标签那一块也不能画底色。`hitRegions` 是盖在网页上的 Plasticine 浮层（对话框、圆球、菜单、弹层），
  CSS 像素、相对主网页视口，拖对话框时每帧更新。
- **事件怎么分**（`ChromeHitRouter`）：落在 `hitRegions` 里给主网页 → 顶栏空白拖窗口 → 网页标签区给网页标签 → 其余给主网页。
  点击、滚轮、右键菜单、手势走内容视图的 `hitTest`；键盘焦点跟着点到的那个网页走；文本选择跟着按下时的那个网页；
  鼠标移动两层都有跟踪区，各自只收自己那一块（光标、悬停不打架）；拖放由最上面一层透明视图按同样规则转给该收的网页，
  换目标时先让旧的离开再让新的进入。

| 方向 | 消息 | 说明 |
| --- | --- | --- |
| 网页 → 原生 | `windowChrome.titlebar({ height, noDrag: Rect[] })` | 走 `plasticineChrome`（不要回执）；布局变了就再报一整份 |
| 网页 → 原生 | `windowChrome.current()` → `{ trafficLightInset, fullScreen }` | 同步回值；还没换外观时也按换了之后算，网页第一次布局就留好安全区 |
| 原生 → 网页 | `__plasticineWindowChrome({ trafficLightInset, fullScreen })` | 换外观、进出全屏时 |

### 沉浸式翻译（0.4.0）

用户 2026-11-03 定「点了才翻 · 双语对照」。协议在 `agent/shared/api/mac-translate.ts`，Swift 侧
`web-translate-protocol.swift`（纯逻辑，XCTest）和 `web-translate.swift`。设备不调模型：段落经原生层交给网页界面，
网页界面调 `POST /v2/translate`，译文再经原生层送回网页标签。

- **注入脚本**：所有网页标签共用一个 `WKUserContentController`，每个主 frame 文档载入完在独立脚本世界
  `PlasticineTranslate` 里装上 `TranslatePageScript`（`translate-page-script.swift`，由
  `node scripts/generate-translate-script.ts` 从 `client/src/mac/translate-page*.ts` 去类型生成，不要手改；`npm run lint`
  核对它是最新的）。页面自己的脚本看不到这段脚本，也拿不到它的消息通道 `plasticineTranslatePage`。
- **切段与插入**：正文段落、标题、列表项、表格格、引用、图注；跳过导航、页面级页头页脚、按钮、输入框、代码、可编辑区、
  藏起来的、已经是目标语言的；输入框里填的字从不读。视口里的先送（IntersectionObserver，往下一屏预取），新冒出来的
  内容接着切（MutationObserver）。没回来的段落放两三条灰条（减少动态效果时不动），回来换成译文：双语对照插在原文里
  末尾，左边 1px 细线；只看译文把原文藏起、悬停看原文。关掉全部还原。悬停译文出工具条（影子 DOM）：重译、复制（原生
  写剪贴板）、问这一段。
- **原生记住想要的状态**：网页界面 `configure(tabId, { run, target, display } | null)`；页面换了文档，脚本报 `page`
  后原生按想要的状态接着开。付款类页面（`DeviceLanePolicy.isPaymentPage`，和网页标签动作同一套判法）和页面上有卡号框的
  不开，报 `page` 时带 `blocked: true`，网页工具条上的「文A」置灰。

| 方向 | 消息 | 说明 |
| --- | --- | --- |
| 网页 → 原生 | `translate.configure(tabId, config \| null)` | 走 `plasticineTranslate`；`run` 换了是重新开，同一个 `run` 只换 `display` 就地切 |
| 网页 → 原生 | `translate.deliver(tabId, { run, items, failed })` | 一批译文；`run` 不是想要的那一轮就丢掉 |
| 原生 → 网页 | `__plasticineTranslateEvent({ type: 'page' \| 'request' \| 'progress' \| 'ask', tabId, … })` | 脚本的消息补上 `tabId`；关掉后在路上的 `request` / `progress` 不转 |

当前 `client/src/mac/use-mac-commands.ts` 在登录后的 Shell 安装三个入口，并在卸载时清理：

- `__plasticineFocusComposer()`：展开并聚焦现有对话，保留草稿。
- `__plasticineNewNote()`：沿用现有 noteOps/requestId 新建笔记，失败继续可核实。
- `__plasticineAttachFiles([{ name, type, base64 }])`：校验、转 File、走现有附件上传并放到待发区。

**网页需要包含这部分客户端改动**，菜单和 Dock 附件入口才可用；复制 `mac/` 只能安装原生壳。
页面尚未加载时先保留操作，加载后等待桥接就绪。网页提供 `notify` 调用时才发原生通知；
这次没有另建 APNs 推送服务，睡眠或退出 App 后不会收到新的原生本地通知。

## 设备助手（plasticine-helper，第 14、15 条）

2026-11-06 他定：设备能力做成由 Electron 壳调用的助手进程。截屏、点按、文件、命令的实现从 App 目标搬进
`Sources/PlasticineDevice`（两个可执行目标共用，`package` 访问级别），`Sources/PlasticineHelper` 是助手本身：
stdin / stdout 上一行一个 JSON，没有窗口、没有 Dock 图标。另加 Apple 日历和提醒事项（EventKit）。浏览器、窗口、通知、
登录搬进 Electron，不在助手里。原 App 目标先留着，等 Electron 版上线再删。`build.sh` 另出 `build/plasticine-helper`。
协议和方法见 `agent/shared/desktop-helper-protocol.ts` 与 `Sources/PlasticineHelper/`。

## 文件清单

| 文件或目录 | 职责 |
| --- | --- |
| `Package.swift`、`Resources/Info.plist`、`build.sh` | Swift Package、bundle 元数据、打包和可选安装 |
| `scripts/make-icon.swift` | 生成陶土橙圆角方块与白色 P 的各尺寸 PNG |
| `Sources/Plasticine/entry-point.swift`、`app-delegate.swift`、`native-layout.swift` | App 生命周期、菜单和原生布局 |
| `web-window.swift`、`web-navigation.swift`、`web-downloads.swift`、`web-bridge.swift` | 主窗口及 WebKit 集成 |
| `global-shortcut.swift`、`notifications.swift`、`file-attachments.swift` | 快捷键、通知、拖入附件 |
| `settings-window.swift`、`folders-window.swift`、`pairing-window.swift` | 设置、目录授权、节点配对窗口 |
| `app-settings.swift`、`node-credential-store.swift`、`native-prompts.swift`、`permissions.swift` | 配置、节点凭证文件（含从旧钥匙串搬一次）、确认与权限 |
| `app-instances.swift` | 启动时结束旧实例、退出兜底（第 5 条） |
| `node-protocol.swift`、`json-value.swift`、`node-http.swift` | 协议编解码及 HTTP |
| `node-service.swift`、`action-journal.swift`、`device-limits.swift` | 长轮询、回执接续、设备上限 |
| `action-executor.swift`、`file-actions.swift`、`file-data.swift`、`browser-actions.swift` | 文件、网页和应用动作 |
| `command-runner.swift`、`command-child.swift` | 命令及可取消的进程组 |
| `PlasticineDevice/`：`path-policy.swift`、`bounded-output.swift`、`screen-geometry.swift`、`screen-actions.swift` | 路径、截断、截图坐标及输入 |
| `PlasticineDevice/`：`json-value.swift`、`digest.swift`、`file-actions.swift`、`file-data.swift`、`command-runner.swift`、`command-child.swift`、`image-diff.swift`、`system-access.swift` | App 和助手共用的设备实现（App 侧 `file-action-params.swift` 接 ActionParams、`device-exports.swift` 统一导出） |
| `PlasticineDevice/`：`helper-protocol.swift`、`helper-params.swift`、`helper-methods.swift`、`helper-dispatcher.swift`、`helper-server.swift`、`key-chord.swift` | 助手的 JSON 行协议、参数核对、方法表、并发与取消、组合键 |
| `PlasticineDevice/`：`calendar-store.swift`、`calendar-policy.swift`；`PlasticineHelper/entry-point.swift` | Apple 日历和提醒事项；助手入口 |
| `image-diff.swift`、`device-lane.swift` | 点击 / 输入后前后截图比对；设备侧付款 / 敏感动作判道（含网页标签的 DOM 判道） |
| `web-tabs.swift`、`web-tab-delegate.swift`、`web-tab-protocol.swift` | 网页标签：原生 WKWebView 的增删显隐、导航与新窗口、桥接消息和纯逻辑 |
| `web-tab-dom.swift`、`tab-actions.swift` | 网页标签的 DOM 脚本；`tab_*` 设备动作（让路、DOM 判道、读回证明） |
| `window-chrome.swift`、`window-chrome-geometry.swift`、`chrome-views.swift` | 交通灯并进顶栏、拖窗口；事件分给主网页 / 网页标签的视图和纯逻辑 |
| `web-translate.swift`、`web-translate-protocol.swift`、`translate-page-script.swift`（生成） | 沉浸式翻译：注入脚本、两条消息通道、付款页判法 |
| `web-page-tools.swift`、`web-page-tool-protocol.swift`、`circle-page-script.swift`（抄自 client） | 网页工具：查找、缩放、截图、打印、圈一块、缩略图、下载（第 2 批） |
| `page-operate.swift`、`page-operate-script.swift`（抄自 `client/src/mac/page-operate.ts`） | 问这一页 → 感知并操作整页（第 3 批）：感知（结构 + 编号）、`tab_perceive` / `tab_act`、光点、步骤事件 `operate`、提交没放行不点（`submit_needs_you`） |
| `login-sites.swift`、`logins-bridge.swift`、`login-import-chrome.swift`、`login-import-safari.swift` | 登录（第 3 批，协议见 `agent/shared/api/mac-logins.ts`）：登录着的网站、退出、从 Chrome（Chrome Safe Storage 解密）/ Safari（完全磁盘访问）搬一次登录状态（Cookie）；0.7.0 起不存、不导密码 |
| `process-run.swift`、`self-signing.swift`、`self-update.swift`、`self-update-install.swift`、`self-update-metadata.swift` | 内部工具执行、自签证书、自更新编排 / 安装 / 元数据 |
| `server-mode.swift`、`local-server.swift`、`release-update.swift` | 安装包：这台 Mac / 远程、看护自带的服务进程、从发布点自更新与一步回退 |
| `Tests/PlasticineTests/*.swift` | 路径、截断、JSON 协议、截图坐标、文件版本、回执接续、画面比对、设备道、自更新、网页标签、窗口外观的 XCTest |
| `../client/src/mac/use-mac-commands.ts`、`../client/src/shell/shell.tsx` | 网页原生入口挂接 |
| `../client/src/shell/use-native-web-tabs.ts`、`web-tab-view.tsx` | 网页标签同步给原生层、地址条 |
| `../client/tests/shell/mac-bridge.test.tsx` | jsdom + React 桥接行为测试 |
| `../scripts/lint.ts` | 跳过 mac 及其 Swift 构建产物 |

## 早期 Windows 环境验证记录与真机范围

本节保留早期验证记录，不代表本轮最新状态。2026-11-06 的 #440 已通过 Mac 编译、98 项 XCTest 与实际 App 本机服务
smoke。CI 不代替原生权限、窗口与真实设备动作确认。

早期 Windows 环境没有 Swift 编译器，当时未声称 Swift 编译、XCTest、原生窗口截图或真实设备动作已验收。
根目录使用 `npm run check`，桥接测试可单跑 `npm exec -w client -- vitest run tests/shell/mac-bridge.test.tsx`。
Swift 源文件每个不超过 300 行；新代码没有使用 macOS 14 之后的专属 API。
当时 Windows 检查结果：lint、typecheck 通过；服务端和脚本 1463 通过、7 跳过，客户端 686 通过。
另外完成 Info.plist 的 XML 解析、Swift 文件行宽/行数和 `git diff --check` 静态检查。

以下为早期列出的真机核对范围，实际完成情况按每次验收记录：

1. Carbon `InstallEventHandler` / `RegisterEventHotKey` 在实际 SDK 中的 C 函数桥接及系统快捷键冲突。
2. ScreenCaptureKit 异步方法签名、录屏授权及 Retina 截图到 CGEvent 的坐标转换。
3. 临时签名 App 的通知授权、钥匙串访问、SMAppService 登录项批准及更新后的权限识别。
4. 系统设置深链接在 macOS 27 上是否定位到对应页面；无法定位时手动进入设置。
5. 命令取消、大量 stdout/stderr、网络中断回执恢复、网页 target=_blank/下载及菜单快捷键。

API 选择依据：[Apple 截图接口](https://developer.apple.com/documentation/screencapturekit/scscreenshotmanager)
（[WWDC23 的 macOS 14 截图介绍](https://developer.apple.com/videos/play/wwdc2023/10136/)）、
[SMAppService](https://developer.apple.com/documentation/servicemanagement/smappservice)、
[WKDownloadDelegate](https://developer.apple.com/documentation/webkit/wkdownloaddelegate)。
