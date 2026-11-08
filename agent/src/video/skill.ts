// 视频解析作为技能装进 Plasticine 的数据层（《优化清单》第 9 条 + 第 1 条：技能、提示词、记忆都在用户数据目录，
// 程序更新不碰）：第一次启动时把 SKILL.md 和三份默认提示词写进 <数据目录>/skills/video-parse/；已经在了就不动——
// 他（或 Plasticine）改过的提示词不会被新版本盖掉。解析时从这里读提示词，读不到才用程序里的默认。

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DEFAULT_PROMPTS, type VideoPromptName } from './digest.ts';

export const VIDEO_SKILL_NAME = 'video-parse';
const SKILL_SOURCE = new URL('./skill/SKILL.md', import.meta.url);

export function videoSkillDirectory(stateDirectory: string): string {
  return join(stateDirectory, 'skills', VIDEO_SKILL_NAME);
}

/** 没装过就装上；回 true 表示这次装的。 */
export function seedVideoSkill(stateDirectory: string): boolean {
  const directory = videoSkillDirectory(stateDirectory);
  if (existsSync(join(directory, 'SKILL.md'))) {
    return false;
  }
  // 先写到旁边的临时目录再整个挪过去：装到一半断电不会留下半个技能。
  const staging = `${directory}.installing`;
  mkdirSync(join(staging, 'prompts'), { recursive: true, mode: 0o700 });
  writeFileSync(join(staging, 'SKILL.md'), readFileSync(SKILL_SOURCE, 'utf8'), { mode: 0o600 });
  for (const [name, text] of Object.entries(DEFAULT_PROMPTS)) {
    writeFileSync(join(staging, 'prompts', `${name}.md`), `${text}\n`, { mode: 0o600 });
  }
  renameSync(staging, directory);
  return true;
}

/** 技能目录里的提示词；没有或是空的就回 null（用默认）。 */
export function skillPrompt(stateDirectory: string): (name: VideoPromptName) => string | null {
  return (name) => {
    const file = join(videoSkillDirectory(stateDirectory), 'prompts', `${name}.md`);
    if (!existsSync(file)) {
      return null;
    }
    const text = readFileSync(file, 'utf8').trim();
    return text === '' ? null : text;
  };
}
