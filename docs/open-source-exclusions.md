# 开源版里没有的部分

Cyber Hunter 的中心中继不在开源版里：它是 Cyber Hunter 自己的网络服务，不是每个实例都有的东西。
打包脚本（`scripts/packages/exclusions.ts`）读下面这张表，打服务包时把表上的路径删掉，再检查运行时 import
没有指向它们；开源仓库里这些路径本来就不存在，删除是空操作，检查照样跑。

| 路径 | 是什么 |
|---|---|
| `agent/src/network-relay/` | 中继本体：账号与邀请码、密文信封转发、拉黑、任务状态、自己的库；前门（按 SNI / Host 分路）、隧道表、控制连接 |
| `agent/tests/network-relay/` | 中继的测试（含应用测试旁边起的独立中继） |
| `agent/deploy/cyberhunter-relay.service` | 中继的 systemd 单元 |
| `agent/deploy/plasticine-app.service.d/network.conf` | 和中继同机的实例连中继本机口、不开隧道 |
| `scripts/deploy-relay.ts`、`scripts/deploy-relay.test.ts` | 发布时装 / 换 / 退中继 |
| `scripts/relay-copy-db.ts`、`scripts/relay-copy-db.test.ts` | 中继搬家时复制库 |
| `scripts/relay-render.ts`、`scripts/relay-render.test.ts` | 发布时渲染中继这边的 Caddyfile 和环境文件 |
| `scripts/relay-demo.ts` | 本机演示中继 + 隧道 |
| `docs/relay-runbook.md` | 中继运维 |

因为没有中继，开源版里要连中继的端到端测试（两个实例互加好友、群聊、替人答话、跨实例任务、邀请码与拉黑）
也不在；`agent/tests/network/` 只留不需要中继的那几条。`agent/deploy/Caddyfile` 用的是中继独立以前的写法
（Caddy 自己占 443 / 80）。

留在开源里的：`agent/protocol/`（每个实例在网络上的那一头：签名与加密 `crypto.ts`、调中继的 `relay-client.ts`、
隧道客户端 `tunnel-client.ts`、本机 TLS 终结 `tunnel-terminator.ts`、ACME 证书 `certificates.ts` / `acme.ts`）、
`agent/shared/` 里开头标了 Apache-2.0 的文件（线上格式 `net-wire.ts` / `tunnel-wire.ts`、发布清单，和它们用到的类型；别的实现照它就能接进来）——这些按 Apache-2.0；
`agent/src/network/`（联系人、同步、收发、`tunnel.ts`）和对外可见的界面、接口按 AGPL-3.0。

## 许可边界（2026-11-09 他定）

闭源的 Cyber Hunter 中继和以后的任务交易服务，只通过网络协议和 Plasticine 打交道（HTTPS / WebSocket / TLS 隧道），
是两个独立的程序。中继只能用本仓库里按 Apache-2.0 的代码（`agent/protocol/`，和 `agent/shared/` 里开头标了 Apache-2.0 的文件）；
AGPL 的代码一行都不拷进中继。Apache-2.0 的文件只能互相引用、引用 node 内置和 npm 包，
`agent/tests/shared/license-boundary.test.ts` 会检查。
