# Plasticine Mac 设备助手

这里只剩 Mac 上的设备助手：`Sources/PlasticineDevice`（截屏、点按、文件、命令、日历和提醒事项的实现）和
`Sources/PlasticineHelper`（助手进程本身，由 Electron 桌面客户端拉起，stdin / stdout 上一行一个 JSON，没有窗口、
没有 Dock 图标）。最低 macOS 14，Swift Package，不需要完整 Xcode 或第三方包，Swift 语言模式固定为 5。

原来的 Swift Mac App（`Sources/Plasticine`，自带服务、自更新、旧节点迁移桥）2026-11-17 删了：下载页 11-08 起只给
Electron 客户端，已经没人在用旧 App。窗口、网页标签、通知、登录、自更新都在 Electron 壳里
（[desktop/README.md](../desktop/README.md)）。

## 构建与验证

```sh
swift build -c release --product plasticine-helper
swift test
```

构建工作流的 `desktop-mac` 一步打通用二进制（arm64 + x86_64），作为附属可执行文件放进
`Plasticine.app/Contents/MacOS/`，并跑 `swift test`。协议和方法见 `agent/shared/desktop-helper-protocol.ts`
与 `Sources/PlasticineHelper/`；壳的 Info.plist 要带日历和提醒事项的用途说明（`docs/specs/desktop-helper-mac.md`）。

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

## 网页桥接

原生壳和网页界面之间的约定现在由 Electron 壳实现（`desktop/src/`，注入 `window.plasticineDesktop`），形状以
`agent/shared/api/desktop-bridge.ts`、`mac-bridge.ts`、`mac-translate.ts`、`mac-logins.ts` 为准；名字里的 Mac 是历史。
原来写在这里的 Swift 实现细节随旧 App 11-17 删了，要看去 git 历史。
