import { spaceHtmlText } from '../../shared/space-html.ts';
import { spaceDocText } from '../../shared/space-text.ts';
import { RELATION_REACH, TIERS, type MaterialKind, type Tier } from '../../shared/api/visibility.ts';
import { STANDING_PROJECT_IDS, type Contact, type MemoryDoc, type Project } from '../../shared/state.ts';
import type { ProxyMaterial } from '../../shared/proxy-answer.ts';
import { allPages, type StateService } from '../state/index.ts';

export const MATERIAL_TEXT_MAX_CHARS = 4_000;
export const MATERIALS_TOTAL_MAX_CHARS = 20_000;
const SHARED_TIERS: readonly Tier[] = ['public', 'partner', 'friend'];

export interface MaterialEntry {
  kind: MaterialKind;
  id: string;
  title: string;
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

export function listMaterials(state: MaterialState): MaterialEntry[] {
  const topics = state.memoryDocs.docs.live().filter((doc) => doc.kind !== 'project')
    .map((doc): MaterialEntry => ({ kind: 'memory_topic', id: doc.id, title: doc.title,
      suggestion: suggestTier({ kind: 'memory_topic', doc }) }));
  const projects = state.projects.all().map((project): MaterialEntry => ({ kind: 'project', id: project.id,
    title: project.name, suggestion: suggestTier({ kind: 'project', project }) }));
  const notes = allPages((page) => state.notes.list({}, page))
    .map((note): MaterialEntry => ({ kind: 'note', id: note.id, title: note.title, suggestion: null }));
  const spaces = allPages((page) => state.spaces.list({}, page))
    .map((space): MaterialEntry => ({ kind: 'space', id: space.id, title: space.title, suggestion: null }));
  return [...topics, ...projects, ...notes, ...spaces];
}

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
  if (note === undefined || note.deletedAt !== null) {
    return null;
  }
  return { title: note.title, text: state.notes.readBody(note) };
}

export interface GatheredMaterial extends ProxyMaterial {
  id: string;
  tier: Tier;
}

export function gatherMaterials(state: MaterialState, reach: readonly Tier[]): GatheredMaterial[] {
  const gathered: GatheredMaterial[] = [];
  let total = 0;
  for (const mark of state.visibilityMarks.all()) {
    if (mark.confirmedAt === null || !reach.includes(mark.tier) || mark.tier === 'private') {
      continue;
    }
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
