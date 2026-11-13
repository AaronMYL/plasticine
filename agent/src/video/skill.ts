// 视频解析作为技能装进 Plasticine 的数据层（《优化清单》第 9 条 + 第 1 条：技能、提示词、记忆都在用户数据目录，
// 程序更新不碰）：第一次启动时把 SKILL.md 和默认提示词写进 <数据目录>/skills/video-parse/；已经在了就不动——
// 他（或 Plasticine）改过的提示词不会被新版本盖掉；只有没人改过的旧版 SKILL.md 换成新说明。解析时从这里读提示词，
// 读不到才用程序里的默认。

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DEFAULT_PROMPTS, type VideoPromptName } from './digest.ts';

export const VIDEO_SKILL_NAME = 'video-parse';
const SKILL_SOURCE = new URL('./skill/SKILL.md', import.meta.url);

/**
 * 以前版本装进去的 SKILL.md（sha256）。数据目录里的那份和其中之一一字不差，说明没人改过，就换成这一版的说明；
 * 改过的不动（11-09 抖音视频改成直接转写，旧说明里「先用自带字幕」「三份提示词」不对了）。
 */
const RETIRED_SKILL_SHA256: readonly string[] = [
  '90c7d82842fbdedb78472d3aa1923c978c258c77b5123db6f2aaa9f5822d96d3',
  // 11-13：开头加了给人看的名字（title: 视频解析），技能页显示它。
  'd51f6d553a9a7659663d5308afc9e8ab58f2ef487c68dce8560eaa288a3ba8c7',
];

export function videoSkillDirectory(stateDirectory: string): string {
  return join(stateDirectory, 'skills', VIDEO_SKILL_NAME);
}

/** 没装过就装上；回 true 表示这次装的。 */
export function seedVideoSkill(stateDirectory: string): boolean {
  const directory = videoSkillDirectory(stateDirectory);
  const skill = join(directory, 'SKILL.md');
  if (existsSync(skill)) {
    refreshUntouchedSkill(skill);
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

function refreshUntouchedSkill(file: string): void {
  const installed = createHash('sha256').update(readFileSync(file)).digest('hex');
  if (!RETIRED_SKILL_SHA256.includes(installed)) {
    return;
  }
  const next = `${file}.updating`;
  writeFileSync(next, readFileSync(SKILL_SOURCE, 'utf8'), { mode: 0o600 });
  renameSync(next, file);
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
