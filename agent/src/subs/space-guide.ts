// 教模型写空间网页的说明（第 8 批第 6 条，11-09 他定）：报告按内容自由排版，用现成的类（版式底子在
// agent/shared/space-page/），不自己造；来信用固定信纸，只写正文。研究周报、个人回顾、旧空间重写都引这里同一份。
// 11-18 内核优化（Aaron 定 space_write 瘦身）：正文挪进内置技能 agent/builtin-skills/space-writing/SKILL.md，
// space_write 的说明只留规矩、让模型写之前 skill_read 读它；这里从那个文件读，一份正文两处用。
// 类名改了那里一起改（tests/subs/space-guide.test.ts 核对每个类都在底子里）。

import { readFileSync } from 'node:fs';

export const SPACE_SKILL = 'space-writing';
const SKILL_FILE = new URL('../../builtin-skills/space-writing/SKILL.md', import.meta.url);

/** 技能正文里 <!-- 名字 --> 那一行到下一个分隔行之间的一段。 */
function section(text: string, name: string): string {
  const start = text.indexOf(`<!-- ${name} -->\n`);
  if (start < 0) {
    throw new Error(`space-writing 技能里少了「${name}」那一段`);
  }
  const body = text.slice(start + `<!-- ${name} -->\n`.length);
  const end = body.indexOf('\n<!-- ');
  return (end < 0 ? body : body.slice(0, end)).trimEnd();
}

const SKILL_TEXT = readFileSync(SKILL_FILE, 'utf8');

/** 报告和来信都要守的规矩。 */
export const SPACE_RULES = section(SKILL_TEXT, '规矩');

/** 报告的版式和现成的类（第 13 批新版式，照 Aaron 给的参考）。 */
export const REPORT_GUIDE = section(SKILL_TEXT, '报告');

/** 来信的信纸和写法。 */
export const LETTER_GUIDE = section(SKILL_TEXT, '来信');
