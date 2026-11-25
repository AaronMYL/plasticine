# 角色引擎的出处

`engine.js` 是 Plasticine-bot 角色引擎（MIT）打包压缩后的一个文件，队友和主线的头像用它画：角色的身体、脸、
状态动效和右上角的小图标都来自它。文件第一行写着构建它的那次提交；许可证原文在同目录的 `LICENSE`。

重新打包：在 Plasticine-bot 的检出里装好依赖、构建引擎，再在本仓库运行
`node scripts/vendor-plasticine-bot.ts <检出目录>`。只导出界面用到的几样（见脚本里的 `ENGINE_EXPORTS`），
类型写在 `engine.d.ts`；节日主题的按需分包不带。

Plasticine 自己加的：主线头像的泥团和漩涡脸（`client/src/views/mates/bot/plasticine-face.ts`）。
