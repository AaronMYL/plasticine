# 目录地图：改什么去哪

目录名就是模块名，以源码为准。先分**外部技术**（数据库、接口、外部服务和设备）和**内部业务**（一个业务一个包）；
一个完整功能通常同时改三处——业务包里的规则、`state/` 里的存取、`app/` 里的接口。每个模块的 `index.ts` 开头几行
写着它管什么，拿不准先读那几行。

## 我要改……去哪

| 要改的东西 | 去哪 |
|---|---|
| 一个接口（地址、参数、返回） | schema 在 `agent/shared/api/<资源>.ts`；路由和校验在 `agent/src/app/<资源>.ts`；界面调用在 `client/src/api/` |
| 一张表、一类对象怎么存 | `agent/src/state/<对象>.ts`，新迁移在 `agent/src/state/migrations/` |
| 一条业务规则（什么时候做、做成什么样） | 那个业务的包（下面的表） |
| 给模型用的一个工具 | 那个业务的包里的 `tools.ts` 或 `<名字>-tool.ts`；参数 schema 在 `agent/shared/` |
| 主对话、后台线怎么跑（排队、叫停、重试、压缩上下文） | `agent/src/lines/` |
| 模型提供商、凭证、旁路调用 | `agent/src/kernel/` |
| 各模块怎么装到一起、启动顺序 | `agent/src/app/assemble*.ts` |
| 一个页面 | `client/src/views/<页面>/`，样式在同目录的 `.css` |
| 一个到处用的界面零件 | `client/src/primitives/<零件>/` 或 `client/src/shell/` |
| 界面上的颜色、字号、间距、动效 | `client/src/tokens.css`（规矩在 plasticine-visual） |
| 电脑端外壳（Electron） | `desktop/`；Mac 原生外壳在 `mac/` |
| 检查、构建、维护脚本 | `scripts/`（lint 规则 `scripts/lint-rules.ts`，令牌检查 `scripts/token-check/`） |
| 代码和界面的规矩 | `agent/skills/plasticine-code/`、`agent/skills/plasticine-visual/` |

## 云端 `agent/`

```
agent/
  src/          一层目录一个模块，根上不放文件
  shared/       两端共用的 typebox schema、常量、纯函数：对象、接口（api/）、工具参数、事件；不引 src/
  protocol/     Cyber Hunter 网络协议的实现（Apache-2.0）：隧道、中继客户端、证书
  tests/        和 src/ 同样的目录；一个行为一个测试，放在它测的那个模块名下
  skills/       plasticine-code / plasticine-visual 的正本（仓库根的 .claude/skills/ 由 `npm run skills:sync` 同步）
  builtin-skills/  随产品带的技能
  deploy/       部署用的服务文件
```

### 外部技术（不放业务规则）

| 模块 | 管什么 |
|---|---|
| `state/` | 唯一写 SQLite 的地方。一类对象一个文件，只做存取；`migrations/` 只加不改 |
| `app/` | HTTP / WS 接口：一个资源一个文件，路由一张表（`router.ts`）；`assemble*.ts` 把各模块装起来；`main.ts` 是进程入口 |
| `kernel/` | 模型与凭证：pi-ai 的全部内置提供商，凭证存库；旁路调用的 `TextModels` |
| `lines/` | 线：主对话一条 main 线，花时间的事开后台线；排队、叫停、硬线先问、重试、额度暂停、重启续跑、上下文压缩 |
| `tools/` | 工具怎么登记、出错怎么说、要不要先问；几个不属于任何业务的通用工具（看时间、小部件、读附件文字） |
| `cloud-tools/` | 云端执行器：SSH 命令、云端浏览器、邮件收发、附件转文字 |
| `devices/` | 设备服务的云端一侧：节点配对和凭证、动作下发和上限、设备工具 |
| `direct/` | 直连：页面和本体之间的 WebRTC 握手与数据通道 |
| `network/` | Cyber Hunter 网络上本体的这一头：身份钥匙、联系人、消息、分身答话 |
| `system/` | 这台服务器自己的事：每日备份、对外动作的回执幂等、客户端发布记录、界面令牌检查器 |
| `artifacts/` | 文件页的工作目录（`files/` 和 `files-trash/`） |
| `util/` | 谁都能用的小工具：日志、文字、终端输出、校验、链接清洗。不含业务、不引业务包 |

### 内部业务（一个业务一个包）

| 模块 | 管什么 |
|---|---|
| `memory/` | 记忆。`docs/` 现行文档和「记住一句」，`journal/` 今天的记录和忘掉，`curation/` 后台整理，`dream/` 每晚做梦和它的定时，`rules/` 旧规则文档 |
| `mates/` | 队友、群组、主线的身份；每位的 Soul |
| `attention/` | 注意力与渠道：触发扫描、四档渠道、要你定的卡、推送 |
| `tasks/` | 任务：定时线、照卡发送、建议 |
| `heartbeat/` | 心跳：每 30 分钟看一眼短清单 |
| `loop/` | 预测闭环：预测和反应怎么记数、什么时候放手、自己的说明书 |
| `outbound/` | 对外发东西之前的授权 |
| `intake/` | 进门：来源实例、触发、粗筛、去向 |
| `daily/` | 感知来源：信息流、关注点、订阅、书签、站内信；信息流的翻译和点评 |
| `notes/` | 笔记的 AI 活：续写、补充建议、去重、笔记工具 |
| `books/` | 图书：`format/` 解析各种电子书格式；其余是导入、书里找、讨论、大纲和重点、读书工具 |
| `web/` | 网页的 AI 活：整页翻译、提取重点 |
| `subs/` | 空间与订阅（研究周报、个人回顾） |
| `video/` | 视频解析、抖音收藏、视频报告 |
| `projects/` | 项目：默认项目和项目工具 |
| `library/` | 资料库：笔记、空间、书、文件一起的批量操作和资料库工具 |
| `life/` | 记账、付款截图的记账草案 |
| `calendar/` | Mac 上的日历和提醒事项 |
| `skills/` | 技能的安装、目录、读取 |

### 模块之间

- 只经对方的 `index.ts` 往来，不引别的模块的内部文件。出口缺一个名字，就在对方的 `index.ts` 里补一行导出。
- 模块里的文件互相直接引，不绕自己的 `index.ts`（绕了会成圈）。
- `index.ts` 是出口：开头写这个模块管什么，下面是导出，最多再加把这个模块装起来的那一个函数；别的逻辑放别的文件。
- 模块之间可以互相引用，所以**文件顶层不读别的模块的常量**（`const X = 别的模块的常量 + 1` 放进函数里，或者把那个常量放到
  `agent/shared/`）；`module-boundary.test.ts` 会把每个模块单独第一个加载一遍来查。
- 业务包直接用 `state/` 的出口，不为存储另写接口。业务包要调模型，经 `kernel/` 的 `TextModels` 或交给线。
- `util/` 和 `agent/shared/` 不引业务包。
- 包大了按职责分子目录（`memory/docs`、`books/format`），不按「领域层 / 应用层」分。新业务开新目录，带上 `index.ts`。

## 界面 `client/`

```
client/
  src/
    api/          取数：从 agent/shared 导 schema（只经 api/shared.ts），http/ 是真接口，fake/ 是假接口（开发和测试用）
    state/        客户端状态和服务端对象的副本（resource-store、live-query、草稿、滚动位置、界面偏好）
    primitives/   通用零件：一个零件一个目录（index.tsx + styles.css）
    shell/        壳：侧栏、标签与路由、对话容器、手机底栏、浮层、页头、图标、网页标签工具条
    views/        页面：一个页面一个目录
    mac/ ios/     注入原生外壳网页里的脚本
    tokens.css    令牌（浅色、深色各一份）
    main.tsx      App 入口；site.tsx、download.tsx 是官网和下载页的入口
  tests/          和 src/ 同样的目录；根上的 ui-*.test.ts 是界面规矩的自动检查
```

只能往下引：`api/` 最底，不引别的层；`state/` 只引 `api/`；`primitives/` 可以用 `state/`、`api/` 和 `shell/` 里的小零件
（图标、按钮），不引 `views/`；`shell/` 是把页面装起来的壳，它引 `views/`，`views/` 也用它的零件。页面之间可以互相引用组件，
但一个零件被第三个页面用到时，挪进 `primitives/` 或 `shell/`。client 里不强制 `index.ts` 出口
（`client/tests/structure-layers.test.ts` 守着这几条）。

## 一个文件里放什么

- 一个 `state/` 对象文件：建表之外的读写函数、版本处理；不含业务判断。
- 一个 `app/` 资源文件：路由、参数校验、调业务包、组装响应；不含业务判断、不碰库。
- 一个工具文件：名字、中文标签、参数 schema、硬线（要不要先问）、执行函数；执行函数只调业务包的函数。
- 一个零件目录：`index.tsx`（组件）、`styles.css`；状态多的另放 `states.ts`。

## 可以超过 500 行的文件

只干一件事、拆开反而要来回翻的文件可以超过 500 行，登记在 `scripts/lint-rules.ts` 的 `LONG_FILES_ALLOWED` 里并写原因
（现在是：令牌表、接口路由表、图标表这类「一张表」的文件，和假接口的样例数据）。别的源码文件超过 500 行就按职责拆。

## 不许出现的

- 一个文件同时有路由、业务和 SQL。
- 组件里直接 `fetch`；client 里手写接口类型。
- 引别的模块的内部文件；`agent/src/` 根上放文件；文件名用里程碑或批次。
- 同一段逻辑放两份。
- 为了省行数把几个语句、几条 CSS 声明挤到一行。
