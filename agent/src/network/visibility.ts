// 信息层级（第 113 条，规格第 5、8 节）：四档 公开 / 合作 / 朋友 / 私密，三类联系人各能听到的台阶在
// shared/api/visibility.ts 的 RELATION_REACH。材料是记忆主题、项目、笔记三样；没有标的一律私密，Plasticine 的建议
// 要用户确认才算。分身只拿这个联系人够得着、而且用户确认过档位的材料。
//
// 建议器（能跑就行的一版，规则全在 suggestTier）：
// - 记忆主题「关于你」永远私密，不建议；「人」那几页写的是别人，也不替别人公开，不建议；其余话题建议「朋友」。
// - 常驻的「个人」项目不建议；其余项目（含常驻的 Plasticine）建议「合作」——合作方来问的多半是项目上的事。
// - 笔记不建议：笔记多半是自己的草稿，要用户自己挑。上了锁的笔记根本不进列表，也永远不给分身。

import { spaceHtmlText } from '../../shared/space-html.ts';
import { spaceDocText } from '../../shared/space-text.ts';
import { RELATION_REACH, TIERS, type MaterialKind, type Tier } from '../../shared/api/visibility.ts';
import { STANDING_PROJECT_IDS, type Contact, type MemoryDoc, type Project } from '../../shared/state.ts';
import type { ProxyMaterial } from '../../shared/proxy-answer.ts';
import { allPages, type StateService } from '../state/index.ts';

/** 一份材料给分身看时最多这么多字；一次最多这么多字（够答一个问题，不把整个记忆塞进去）。 */
export const MATERIAL_TEXT_MAX_CHARS = 4_000;
export const MATERIALS_TOTAL_MAX_CHARS = 20_000;
const SHARED_TIERS: readonly Tier[] = ['public', 'partner', 'friend'];

export interface MaterialEntry {
  kind: MaterialKind;
  id: string;
  title: string;
  /** Plasticine 的建议（没有行时用它；有了行以 proposed 列为准）。 */
  suggestion: Tier | null;
}

type MaterialState = Pick<StateService, 'memoryDocs' | 'projects' | 'notes' | 'visibilityMarks' | 'spaces'>
  & Partial<Pick<StateService, 'contacts'>>;

export function suggestTier(entry: { kind: 'memory_topic'; doc: MemoryDoc } | { kind: 'project'; project: Project }
  | { kind: 'note' }): Tier | null {
  if (entry.kind === 'memory_topic') {
    return entry.doc.kind === 'topic' ? 'friend' : null;
  }
  if (entry.kind === 'project') {
    return entry.project.id === STANDING_PROJECT_IDS.personal ? null : 'partner';
  }
  return null;
}

/** 档位页的材料：在用的记忆主题（项目档案归项目那一行）、全部项目、没删没上锁的笔记。 */
export function listMaterials(state: MaterialState): MaterialEntry[] {
  const topics = state.memoryDocs.docs.live().filter((doc) => doc.kind !== 'project')
    .map((doc): MaterialEntry => ({ kind: 'memory_topic', id: doc.id, title: doc.title,
      suggestion: suggestTier({ kind: 'memory_topic', doc }) }));
  const projects = state.projects.all().map((project): MaterialEntry => ({ kind: 'project', id: project.id,
    title: project.name, suggestion: suggestTier({ kind: 'project', project }) }));
  const notes = allPages((page) => state.notes.list({}, page)).filter((note) => !note.private)
    .map((note): MaterialEntry => ({ kind: 'note', id: note.id, title: note.title, suggestion: null }));
  const spaces = allPages((page) => state.spaces.list({}, page))
    .map((space): MaterialEntry => ({ kind: 'space', id: space.id, title: space.title, suggestion: null }));
  return [...topics, ...projects, ...notes, ...spaces];
}

/**
 * 这个联系人能听到哪几档：单独调整的上限优先，否则按关系。上限是「到哪一档为止」：设成私密 = 什么都听不到
 * （私密永远只给自己，不会因为上限设得高就漏出去）。
 */
export function reachOf(contact: Pick<Contact, 'relation' | 'tierCap'>): readonly Tier[] {
  if (contact.tierCap === null) {
    return RELATION_REACH[contact.relation];
  }
  const cap = TIERS.indexOf(contact.tierCap);
  return contact.tierCap === 'private' ? [] : SHARED_TIERS.filter((tier) => TIERS.indexOf(tier) <= cap);
}

function clipText(text: string, max: number): string {
  const chars = Array.from(text);
  return chars.length <= max ? text : `${chars.slice(0, max).join('')}…`;
}

function docText(state: MaterialState, docId: string): string {
  return state.memoryDocs.lines.live(docId).map((line) => line.text).join('\n');
}

function projectText(state: MaterialState, project: Project): string {
  const doc = state.memoryDocs.docs.forProject(project.id);
  const parts = [
    project.brief.goal === '' ? '' : `目标：${project.brief.goal}`,
    project.status === null ? '' : `现状：${project.status.text}`,
    project.next === null || project.next === '' ? '' : `下一步：${project.next}`,
    doc === undefined || doc.retiredAt !== null ? '' : docText(state, doc.id),
  ];
  return parts.filter((part) => part !== '').join('\n');
}

function materialOf(state: MaterialState, kind: MaterialKind, id: string): { title: string; text: string } | null {
  if (kind === 'memory_topic') {
    const doc = state.memoryDocs.docs.get(id);
    return doc === undefined || doc.retiredAt !== null ? null : { title: doc.title, text: docText(state, doc.id) };
  }
  if (kind === 'project') {
    const project = state.projects.get(id);
    return project === undefined ? null : { title: project.name, text: projectText(state, project) };
  }
  if (kind === 'space') {
    const space = state.spaces.get(id);
    return space === undefined || space.deletedAt !== null ? null
      : { title: space.title, text: space.html === null ? spaceDocText(space.doc) : spaceHtmlText(space.html) };
  }
  const note = state.notes.get(id);
  if (note === undefined || note.deletedAt !== null || note.private) {
    return null;
  }
  return { title: note.title, text: state.notes.readBody(note) };
}

export interface GatheredMaterial extends ProxyMaterial {
  id: string;
  tier: Tier;
}

/** 分身能用的材料：用户确认过、档位在这个联系人够得着的范围里。没标的、只有建议的一律拿不到。 */
export function gatherMaterials(state: MaterialState, reach: readonly Tier[]): GatheredMaterial[] {
  const gathered: GatheredMaterial[] = [];
  let total = 0;
  for (const mark of state.visibilityMarks.all()) {
    if (mark.confirmedAt === null || !reach.includes(mark.tier) || mark.tier === 'private') {
      continue;
    }
    // 第 12 批：绑了联系人的人物页（记着某个人的事）不管标成哪一档，都不拿去对外答。
    if (mark.objectKind === 'memory_topic' && (state.contacts?.forPersonDoc(mark.objectId).length ?? 0) > 0) {
      continue;
    }
    const material = materialOf(state, mark.objectKind, mark.objectId);
    if (material === null) {
      continue;
    }
    const room = MATERIALS_TOTAL_MAX_CHARS - total;
    if (room <= 0) {
      break;
    }
    const text = clipText(material.text, Math.min(MATERIAL_TEXT_MAX_CHARS, room));
    total += Array.from(text).length;
    gathered.push({ ref: `${mark.objectKind}:${mark.objectId}`, kind: mark.objectKind, id: mark.objectId,
      tier: mark.tier, title: material.title, text });
  }
  return gathered;
}
