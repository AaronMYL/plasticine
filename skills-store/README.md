# 技能商店

Plasticine 技能页「添加 · 商店」里列的就是这个目录：`index.json` 是清单，每个技能一个目录，里面至少有一份 `SKILL.md`。
Plasticine 直接从 GitHub 读这里的 `main` 分支（读不到时读 jsDelivr 的镜像），所以改了推上去就生效，不用发版。

加一个技能：

1. 新建目录 `<短名>/`，写 `SKILL.md`。开头三行：`name`（和目录同名，小写字母、数字、连字符）、`title`（给人看的名字）、
   `description`（什么时候用，一句话）。正文写方法：做成是什么样，再分步骤。
2. 在 `index.json` 里加一项：`name`、`title`、`description`、`category`、`source`（`official` 是我们自己写的，
   `community` 是别人写、我们看过的）、`updatedAt`、`files`（这个技能的全部文件，第一个是 `SKILL.md`）。
3. 跑 `node --test agent/tests/skills/store-catalog.test.ts`：清单和每个技能的格式都会查一遍。

只收文字文件。带脚本的技能界面上会标「带脚本」，脚本第一次运行前 Plasticine 照常先问用户。
别人写的技能放进来以前，先确认它的许可允许转载，并在它的 `SKILL.md` 里写明出处。
