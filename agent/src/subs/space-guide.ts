import { readFileSync } from 'node:fs';

export const SPACE_SKILL = 'space-writing';
const SKILL_FILE = new URL('../../builtin-skills/space-writing/SKILL.md', import.meta.url);

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

export const SPACE_RULES = section(SKILL_TEXT, '规矩');

export const REPORT_GUIDE = section(SKILL_TEXT, '报告');

export const LETTER_GUIDE = section(SKILL_TEXT, '来信');
