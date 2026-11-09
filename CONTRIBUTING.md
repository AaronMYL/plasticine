# 参与

1. 先看 [BOUNTIES.md](BOUNTIES.md) 和 Issues，在 Issue 里说一声你要做哪条。
2. Fork，开分支，改。代码规矩见 `agent/skills/plasticine-code/SKILL.md`，界面规矩见 `agent/skills/plasticine-visual/SKILL.md`。
3. 仓库根目录 `npm ci`，然后 `npm run check`（lint、类型检查、服务端 / 脚本 / 桌面测试、界面测试）要过；新功能带测试。
4. 提 PR，说明改了什么、怎么验的；界面改动附电脑和手机截图。

代码风格：跟周围的代码一致；用户看到的文字用平常的中文，先说结论。

## 贡献的授权

Plasticine 按 [AGPL-3.0](LICENSE) 开源；`agent/protocol/` 和 `agent/shared/` 里开头标了 Apache-2.0 的文件按 [Apache-2.0](LICENSES/Apache-2.0.txt)。
提交 PR 即表示你同意：

- 你的贡献是你自己写的，或者你有权提交；
- 你的贡献按它所在文件的协议公开；
- 同时免费、不可撤销地授权版权人（AaronMYL）按别的条款使用你的贡献，比如上架应用商店，或者和闭源的 Cyber Hunter 服务一起用。
