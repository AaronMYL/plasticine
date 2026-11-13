// 技能页共用的几样：来源怎么叫、给人看的名字、SKILL.md 去掉开头那段元信息、把目录一页页读全。

import type { SkillsApi } from '../../api/capabilities-client.ts';
import type { SkillListResponse, SkillRow, SkillSource } from '../../api/shared.ts';

export type SkillKind = SkillSource['kind'];
export const SOURCE_LABELS: Record<SkillKind, string> = { builtin: '随应用', installed: '你添加的',
  agent: 'Plasticine 整理' };
export const SKILL_NAME_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const PAGE_SIZE = 20;
const PAGES_MAX = 20;

/** 给人看的名字：SKILL.md 里写了 title 用它，没写用短名。 */
export function skillLabel(skill: { name: string; title?: string | null | undefined }): string {
  return skill.title == null || skill.title === '' ? skill.name : skill.title;
}

/** 这个技能是哪来的，一句话。 */
export function originText(source: SkillSource): string {
  if (source.kind === 'builtin') return '跟着应用更新';
  if (source.kind === 'agent') return 'Plasticine 把做成过的做法记下来的';
  if (source.origin.startsWith('store:')) return '从商店装的';
  if (source.origin.startsWith('url:')) return '从网址装的';
  if (source.origin === 'files') return '从文件装的';
  return source.origin === 'user' ? '你写的' : '你添加的';
}

/** SKILL.md 开头两行 --- 之间是元信息（名字、什么时候用），给人看方法时不带。 */
export function methodText(text: string, complete = true): string {
  const opening = /^﻿?---[ \t]*\r?\n/.exec(text);
  if (opening === null) { return text; }
  const rest = text.slice(opening[0].length);
  const closing = /^---[ \t]*(?:\r?\n|$)/m.exec(rest);
  if (closing === null) { return complete ? text : ''; }
  return rest.slice(closing.index + closing[0].length);
}

/** 目录一页最多 20 个：一页页读全（技能不会多，最多读 20 页）。 */
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
