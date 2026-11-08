# M6 共享浏览器部署

由 Claude 安装。本次只交付代码与单元文件，没有连接服务器或执行以下命令。
前提是已经验证的 Chromium 156 snap、Xvfb、plasticine 用户和已开启的 linger。

1. 将 `plasticine-browser.service` 放到
   `/home/plasticine/.config/systemd/user/plasticine-browser.service`，归属 `plasticine:plasticine`。
   保留 `/home/plasticine/browser-profile` 的已有内容；首次不存在时才由 plasticine 创建，权限 0700。
2. 在 **plasticine 的真实登录会话**中运行：

   ```sh
   systemctl --user daemon-reload
   systemctl --user enable --now plasticine-browser.service
   systemctl --user status plasticine-browser.service
   ```

   如果 Claude 在 root 管理会话中操作，用用户 manager 的连接方式：

   ```sh
   systemctl --user --machine=plasticine@.host daemon-reload
   systemctl --user --machine=plasticine@.host enable --now plasticine-browser.service
   systemctl --user --machine=plasticine@.host status plasticine-browser.service
   ```

   不用系统级服务启动 Chromium，不用 `sudo -u plasticine chromium`。
   单元不设 `User=`，由已有的用户 manager 建立 snap 所需的 cgroup。
3. 在服务器本机确认 `ss -ltnp '( sport = :9333 )'` 只有 `127.0.0.1:9333`。
   `/json/version` 应在本机可访问。CDP 地址固定为此回环端口，不开放公网端口、不新增 Caddy 转发。
4. 按仓库既有发布流程安装此次 agent 和 client，由 Claude 执行必要的服务重启。
   agent 默认使用真实 CDP，按需连接，不需要浏览器凭据或新依赖。
   `PLASTICINE_DRY_RUN=1` 可以保留：只拦脑的外部操作，用户在浏览器页亲手操作立即执行。
5. 从工具 → 浏览器验收：打开 HTTP/HTTPS 页面、前后退、刷新、新开/关闭/切换标签、中文输入、鼠标和滚轮。
   登录与验证由用户在画面中操作。脑的操作须先获得现有授权；脑用浏览器时顶部显示占用，用户操作立即接手。
   停止浏览器服务后应看到「浏览器还没起来」和「重试」，启动后可重连。

画面走 `/v2/browser/stream` 的同源会话 SSE；每个帧确认都验证会话归属。
新观看页接替旧观看页；画面、手动操作正文、手动操作去重信息不进入数据库或日志。
用户输入会到网站及 Chromium 的正常 profile，登录状态由该 profile 保留。
浏览器单元关闭 stdout/stderr，避免 Chromium 自己的诊断将页面输入写入 journal。

手动操作的标识只在内存去重；每代最多 2048 次请求后更换 instanceId，客户端随状态自动更新。
重启后的旧代请求会被拒绝，客户端不保存或自动重发操作。断线时先看画面核实，再重新操作。
脑的操作继续使用原有工具回执、授权卡和工具组开关。
关闭最后一个标签页时先建立一个空白页，避免 Chromium 正常退出后用户服务没有触发失败重启。
用户接手只能阻止尚未发送的后续命令；已经送出的点按或输入可能已生效，脑会保留未知回执要求核对。

协议依据：[Chrome DevTools Protocol](https://chromedevtools.github.io/devtools-protocol/)。
仍须由 Claude 在已装好的真实 Chromium 上完成登录、验证及 snap 用户服务的最终验收。
