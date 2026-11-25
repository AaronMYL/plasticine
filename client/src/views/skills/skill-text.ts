import type { SkillsApi } from '../../api/capabilities-client.ts';
import type { SkillListResponse, SkillRow, SkillSource } from '../../api/shared.ts';

export type SkillKind = SkillSource['kind'];
export const SOURCE_LABELS: Record<SkillKind, string> = { builtin: '随应用', installed: '你添加的',
  agent: 'Plasticine 整理' };
export const SKILL_NAME_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const PAGE_SIZE = 20;
const PAGES_MAX = 20;

export function skillLabel(skill: { name: string; title?: string | null | undefined }): string {
  return skill.title == null || skill.title === '' ? skill.name : skill.title;
}

export function originText(source: SkillSource): string {
  if (source.kind === 'builtin') return '跟着应用更新';
  if (source.kind === 'agent') return 'Plasticine 把做成过的做法记下来的';
  if (source.origin.startsWith('store:')) return '从商店装的';
  if (source.origin.startsWith('url:')) return '从网址装的';
  if (source.origin === 'files') return '从文件装的';
  return source.origin === 'user' ? '你写的' : '你添加的';
}

export function methodText(text: string, complete = true): string {
  const opening = /^﻿?---[ \t]*\r?\n/.exec(text);
  if (opening === null) { return text; }
  const rest = text.slice(opening[0].length);
  const closing = /^---[ \t]*(?:\r?\n|$)/m.exec(rest);
  if (closing === null) { return complete ? text : ''; }
  return rest.slice(closing.index + closing[0].length);
}

export async function loadAllSkills(api: SkillsApi, signal: AbortSignal)
  : Promise<Pick<SkillListResponse, 'skills' | 'issues'>> {
  const skills: SkillRow[] = [];
  let issues: SkillListResponse['issues'] = [];
  let offset: number | null = 0;
  for (let page = 0; offset !== null && page < PAGES_MAX; page += 1) {
    const result: SkillListResponse = await api.list({ offset, limit: PAGE_SIZE }, signal);
    skills.push(...result.skills);
    issues = result.issues;
    offset = result.nextOffset;
  }
  return { skills, issues };
}
