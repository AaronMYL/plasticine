import type { MemoryAnchor, MemoryJournalEntry, ReviewSettings, SpaceEdition, SpaceLink }
  from '../../shared/state.ts';
import { localDay } from '../daily/index.ts';
import type { StateService } from '../state/index.ts';
import { rankInterests, type Interest } from './interests.ts';

export type ReviewState = Pick<StateService, 'memoryJournal' | 'memoryDreams' | 'memoryDocs' | 'projects'
  | 'feedSources' | 'feedItems' | 'bookmarks'>;

const DAY_MS = 24 * 60 * 60 * 1000;
const WEEK_DAYS = 7;
const TALK_DAYS = 14;
const DREAM_WINDOW_MS = DAY_MS;
const PROJECT_EVENTS_MAX = 8;
const SAVED_MAX = 12;
const SAVED_DAYS = 30;

export interface ReviewEntry {
  kind: MemoryJournalEntry['kind'];
  day: string;
  text: string;
  links: SpaceLink[];
}

export interface ReviewMaterials {
  edition: SpaceEdition;
  from: string;
  to: string;
  entries: ReviewEntry[];
  dream: { finishedAt: string; total: number; add: number; replace: number; unsure: number; deadEnd: number } | null;
  projects: { id: string; name: string; events: string[] }[];
  interests: Interest[];
  sources: string[];
}

function linkOf(anchor: MemoryAnchor): SpaceLink | null {
  if (anchor.kind === 'message') {
    return { kind: 'message', id: anchor.ref };
  }
  return anchor.kind === 'note' ? { kind: 'note', id: anchor.ref } : null;
}

function fromExcludedLines(entry: MemoryJournalEntry, lines: ReadonlySet<string>): boolean {
  const refs = entry.anchors.filter((anchor) => anchor.kind === 'message').map((anchor) => anchor.ref.split(':')[1]);
  return refs.length > 0 && refs.every((lineId) => lineId !== undefined && lines.has(lineId));
}

function excluded(settings: ReviewSettings, kind: ReviewSettings['exclude'][number]['kind']): Set<string> {
  return new Set(settings.exclude.filter((item) => item.kind === kind).map((item) => item.id));
}

function journal(state: ReviewState): MemoryJournalEntry[] {
  return [...state.memoryJournal.open(), ...state.memoryJournal.archived()];
}

function dreamOf(state: ReviewState, at: Date): ReviewMaterials['dream'] {
  const dream = state.memoryDreams.latest();
  if (dream?.finishedAt == null || at.getTime() - Date.parse(dream.finishedAt) > DREAM_WINDOW_MS
    || Date.parse(dream.finishedAt) > at.getTime()) {
    return null;
  }
  const changes = state.memoryDreams.changes(dream.id).filter((change) => change.undoneAt === null);
  const count = (kind: string): number => changes.filter((change) => change.kind === kind).length;
  return { finishedAt: dream.finishedAt, total: changes.length, add: count('add'), replace: count('replace'),
    unsure: count('unsure'), deadEnd: count('dead_end') };
}

function interestsOf(state: ReviewState, settings: ReviewSettings, entries: MemoryJournalEntry[], at: Date,
  timeZone: string, skipProjects: ReadonlySet<string>, skipDocs: ReadonlySet<string>): Interest[] {
  const explicit = [...settings.topics, ...state.feedSources.all({ kind: 'interest' })
    .filter((source) => source.level !== 'off').map((source) => source.label)];
  const since = new Date(at.getTime() - SAVED_DAYS * DAY_MS).toISOString();
  const saved = [
    ...state.feedItems.page({ saved: true }, { limit: SAVED_MAX }).map((item) => item.title),
    ...state.bookmarks.live().filter((mark) => mark.createdAt >= since).map((mark) => mark.title),
  ].filter((title) => title.trim() !== '').slice(0, SAVED_MAX);
  const projects = state.projects.all()
    .filter((project) => project.lifecycle === 'active' && !skipProjects.has(project.id))
    .map((project) => ({ id: project.id, name: project.name }));
  const talkFrom = localDay(new Date(at.getTime() - TALK_DAYS * DAY_MS), timeZone);
  const talk = entries.filter((entry) => entry.docId !== null && !skipDocs.has(entry.docId) && entry.day >= talkFrom)
    .map((entry) => ({ day: entry.day, docId: entry.docId ?? '',
      title: state.memoryDocs.docs.get(entry.docId ?? '')?.title ?? '' }))
    .filter((entry) => entry.title !== '');
  return rankInterests({ explicit, saved, projects, talk });
}

export function reviewMaterials(state: ReviewState, settings: ReviewSettings, edition: SpaceEdition, at: Date,
  timeZone: string): ReviewMaterials {
  const span = edition === 'daily' ? 1 : WEEK_DAYS - 1;
  const from = localDay(new Date(at.getTime() - span * DAY_MS), timeZone);
  const to = localDay(at, timeZone);
  const start = new Date(at.getTime() - (span + 1) * DAY_MS).toISOString();
  const skipLines = excluded(settings, 'line');
  const skipProjects = excluded(settings, 'project');
  const skipDocs = excluded(settings, 'memory_doc');
  const all = journal(state).filter((entry) => !fromExcludedLines(entry, skipLines)
    && (entry.docId === null || !skipDocs.has(entry.docId)));
  const entries = all.filter((entry) => entry.day >= from && entry.day <= to).map((entry) => ({
    kind: entry.kind, day: entry.day, text: entry.text,
    links: entry.anchors.map(linkOf).filter((link): link is SpaceLink => link !== null) }));
  const projects = state.projects.all()
    .filter((project) => project.lifecycle === 'active' && !skipProjects.has(project.id))
    .map((project) => ({ id: project.id, name: project.name,
      events: state.projects.events.recent(project.id, PROJECT_EVENTS_MAX)
        .filter((event) => event.createdAt >= start).map((event) => event.text) }))
    .filter((project) => project.events.length > 0);
  const skipSources = excluded(settings, 'feed_source');
  const sources = settings.sources.length > 0 ? settings.sources : state.feedSources.all({ kind: 'interest' })
    .filter((source) => source.level !== 'off' && !skipSources.has(source.id)).map((source) => source.label);
  return { edition, from, to, entries, dream: dreamOf(state, at), projects,
    interests: interestsOf(state, settings, all, at, timeZone, skipProjects, skipDocs), sources };
}
