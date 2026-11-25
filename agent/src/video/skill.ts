import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DEFAULT_PROMPTS, type VideoPromptName } from './digest.ts';

export const VIDEO_SKILL_NAME = 'video-parse';
const SKILL_SOURCE = new URL('./skill/SKILL.md', import.meta.url);

const RETIRED_SKILL_SHA256: readonly string[] = [
  '90c7d82842fbdedb78472d3aa1923c978c258c77b5123db6f2aaa9f5822d96d3',
  'd51f6d553a9a7659663d5308afc9e8ab58f2ef487c68dce8560eaa288a3ba8c7',
];

export function videoSkillDirectory(stateDirectory: string): string {
  return join(stateDirectory, 'skills', VIDEO_SKILL_NAME);
}

export function seedVideoSkill(stateDirectory: string): boolean {
  const directory = videoSkillDirectory(stateDirectory);
  const skill = join(directory, 'SKILL.md');
  if (existsSync(skill)) {
    refreshUntouchedSkill(skill);
    return false;
  }
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
