# 当前目录与模块边界

目录名就是模块名。2026-11-05 Harness 推倒重做之后，云端按「内核 + 业务」分：内核只做六件事（上下文、循环、线、触发、
边界、看得见管得住），跑在上游 pi 1.5.x 上（不 fork）；业务各一个目录，把自己的工具交给内核。每个目录一个 `index.ts`
出口；目录里的文件只被本目录和 `index.ts` 引用。以源码为准，旧方案不作为仍有某个目录的证据。

## 云端 agent

```
agent/
  src/
    kernel/           模型与凭证：pi-ai 的 Models 装上全部内置提供商，凭证存库；旁路调用的 TextModels（翻译、笔记、记忆整理）
    lines/            线：主对话 main 一条线，要花时间的事开后台线；排队、立即发送、叫停、硬线先问、重试、额度暂停、重启续跑
    brain/            给内核的业务工具（tools/ 每个工具一个文件，参数 schema 来自 shared/）和几个旁路助手
    attention/        注意力与渠道：触发条件扫描、四档渠道、要你定的卡、推送；自己不调模型
    state/            共同状态服务：唯一写 SQLite 的地方；每类对象一个文件
      migrations/       迁移：只加不改旧迁移；0059 起可以是 destructive（删表、删列）
    system/           这台电脑自己的事：每日备份、寄给他的通知信、对外动作幂等（external-once、receipts）、
                      客户端发布记录、界面令牌检查器
    cloud-tools/      云端执行器：SSH 命令、云浏览器、外部服务
    devices/          设备服务的云端一侧：配对、能力清单、上限、动作下发
    app/              HTTP / WS 接口：每个资源一个文件，路由一张表（router.ts）；assemble*.ts 把各模块装起来
    artifacts/        文件页的工作目录（files/ 与 files-trash/）
    daily/            感知来源：信息流、关注点、站内信同步
    intake/           进门：来源实例与触发
    life/             记账
    books/ reading/   图书：格式转换；导入、书里找、讨论归档
    skills/           技能库（skills_search / skill_read 读这里）
    network/ network-relay/   Cyber Hunter 网络：实例这一头、中心中继
  shared/             typebox schema：对象、接口、工具参数、事件；client 从这里导类型
  tests/              和 src/ 同构，一个源文件对应一个测试文件
  skills/             plasticine-visual / plasticine-code（正本；仓库根的 .claude/skills/ 由 `npm run skills:sync` 同步）
```

## 界面 client

```
client/
  src/
    shell/            侧栏、标签与路由、对话容器、手机四项底栏、浮层和设置弹框；壳不含业务
    primitives/       复用消息、要你定卡、结果链接、就地编辑、Sheet 等现有组件；旧目录名不代表旧业务仍在
    views/            home/ 首页 · messages/ 消息 · contacts/ 联系人与群 · lines/ 对话及工作
                      notes/ 笔记 · feed/ 信息流 · books/ 图书 · projects/ 项目 · memory/ 主题记忆
                      settings/ 设置 · device/ 设备与备份组件 · tools/ 记账和文件 · search/ 查找
    api/              从 shared/ 导 schema，一个资源一个文件；请求、重试、回执不确定的处理
    state/            客户端状态：对话栏滚动位置、草稿、引用片、视图恢复；不复制服务端对象
    tokens.css        方向 I 令牌，浅色与深色各一份（--bg --fg --fg2 --fg3 --line --line2 --tint --tint2 --accent --run --ok --err --scrim --lift --sans --mono；值见 plasticine-visual / visual-foundation.md）
    fonts/            Geist Sans、Geist Mono 的 woff2（只打英文字体，SIL OFL；@font-face 在 tokens.css 里声明，中文走系统回退）
    telemetry.ts      采数事件点，开关可关
  tests/              每个原语、每个视图至少一个测试；壳与对话栏的测试覆盖切视图不丢滚动位置和草稿
```

## 一个文件里放什么

- 一个原语目录：`index.tsx`（组件）、`states.ts`（状态枚举与迁移）、`styles.css`、`index.test.tsx`。
- 一个 state 对象文件：schema 引用、读写函数、版本处理；不含业务判断。
- 一个 app 资源文件：路由、参数校验、调用模块接口、组装响应；不含业务判断、不碰 db。
- 一个 brain 工具文件：名字、中文标签、参数 schema、`replay: safe | once`、执行函数；执行函数只调模块接口。

## 不许出现的

- 一个文件同时有路由、业务和 SQL。
- 组件里直接 `fetch`。
- 模块 A 引 `../b/internal-file.ts`。
- client 里手写接口类型。
- 为了省行数把多个声明挤到一行。
