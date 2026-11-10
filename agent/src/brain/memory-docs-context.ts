import { SOUL_SECTIONS, SOUL_SECTION_LABELS } from '../../shared/api/soul.ts';
import { soulSectionOf } from './soul.ts';
// 记忆文档进上下文（docs/specs/memory-docs.md 第 4 节；《优化清单》第 16 条 11-06 改）：每轮固定只读总目录、「关于你」、
// 「怎么替你做事」、当前项目的档案，加上白天的「今天的记录」；其余由模型按目录用 read_memory_doc 挑着读。
// 总目录由代码生成，不让模型写：每篇一行（名字 + 开头那句简介），按类型分组。每次请求都从库里重读。
// 搜索默认只搜现行；问「以前怎么定的」时带上归档。

import { hardLinesForModel } from '../../shared/rules-doc.ts';
import { RULES_DOC_ID, YOU_DOC_ID, type MemoryDoc, type MemoryDocKind, type MemoryJournalKind,
  type MemoryLine } from '../../shared/state.ts';
import type { StateService } from '../state/index.ts';
import { similarity } from './memory-curation-ops.ts';
import { estimateTokens } from './tokens.ts';

type DocsState = Pick<StateService, 'memoryDocs' | 'projects'>;
type TodayState = Pick<StateService, 'memoryJournal'>;

// 目录最多列这么多份：再多就不是「目录」而是噪音，其余的用 search_memory 找得到。
export const DIRECTORY_MAX_DOCS = 60;
// 「关于你」正文的预算，约一页；超出的写明还有几行，用 read_memory_doc 读全文。
export const YOU_DOC_BUDGET_TOKENS = 1_500;
export const SEARCH_DEFAULT_LIMIT = 20;

// 「今天的记录」最多装这么多（约一页）；更早的写明还有几条，夜里会整理进主题文档。
export const TODAY_BUDGET_TOKENS = 2_000;

const GROUP_LABELS: Readonly<Record<MemoryDocKind, string>> = { you: '关于你和做事方式', rules: '关于你和做事方式',
  project: '项目', person: '人', topic: '话题', skill: '技能' };
const KIND_ORDER: readonly MemoryDocKind[] = ['you', 'rules', 'project', 'person', 'topic', 'skill'];

const HEADER = '## 记忆（按主题整理；用户原话、已确认推断与系统默认分别保留来源）';
const HINT = '目录里每篇一行：名字和「这篇讲什么、什么时候该读」。要用到某篇时用 read_memory_doc 按名字读整篇，'
  + '不知道在哪篇时用 search_memory 搜；他问以前怎么定的，search_memory 带 archive 搜归档。行里的 [[名字]] 指另一篇。'
  + '记下的事不要让用户重讲；和用户这次说的冲突时，以用户最新说的为准。';

/** 一行在上下文里的样子：标识让整理时能对上「回复用到了哪几行」。 */
export function lineText(line: MemoryLine): string {
  const decision = line.section === 'decision' ? '［决定］' : '';
  const origin = line.anchors.every((anchor) => anchor.kind === 'system') ? '（系统默认）' : '';
  const inferred = line.basis === 'confirmed_inference' ? '（你推断、用户确认过）' : '';
  const before = line.previous === null ? '' : `（之前：${line.previous}）`;
  return `- [行:${line.id}] ${decision}${line.text}${origin}${inferred}${before}`;
}

function liveProjectIds(state: DocsState): Set<string> {
  return new Set(state.projects.all().filter((project) => project.lifecycle !== 'done').map((project) => project.id));
}

/** 目录里的顺序：关于你、怎么替你做事、在做的项目、人物、话题；同类按最近改的在前。做完的项目不列。 */
export function directoryDocs(state: DocsState): MemoryDoc[] {
  const projects = liveProjectIds(state);
  return state.memoryDocs.docs.live()
    .filter((doc) => doc.kind !== 'project' || (doc.projectId !== null && projects.has(doc.projectId)))
    .sort((a, b) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind)
      || b.updatedAt.localeCompare(a.updatedAt));
}

function youBody(state: DocsState): string[] {
  const lines = state.memoryDocs.lines.live(YOU_DOC_ID);
  const shown: string[] = [];
  let used = 0;
  for (const line of lines) {
    const text = lineText(line);
    const cost = estimateTokens(text);
    if (used + cost > YOU_DOC_BUDGET_TOKENS) {
      break;
    }
    used += cost;
    shown.push(text);
  }
  const left = lines.length - shown.length;
  if (left > 0) {
    shown.push(`（关于你还有 ${left} 行这次没装，用 read_memory_doc 读 ${YOU_DOC_ID}）`);
  }
  return shown;
}

/** 总目录：按类型分组，每篇一行「名字：简介」。代码生成，模型不写。 */
export function directoryLines(docs: readonly MemoryDoc[]): string[] {
  const lines: string[] = [];
  let group = '';
  for (const doc of docs) {
    const label = GROUP_LABELS[doc.kind];
    if (label !== group) {
      group = label;
      lines.push(`${label}：`);
    }
    lines.push(`- ${doc.title}：${doc.summary === '' ? '（还没有简介）' : doc.summary}`);
  }
  return lines;
}

/** 系统提示里的记忆一段：只列有内容的文档（空文档只是噪音）；一行都还没有时是空的。 */
export function memoryDocsSection(state: DocsState): string {
  const docs = directoryDocs(state).filter((doc) => state.memoryDocs.lines.size(doc.id).lines > 0);
  if (docs.length === 0) {
    return '';
  }
  const more = docs.length > DIRECTORY_MAX_DOCS ? [`（另有 ${docs.length - DIRECTORY_MAX_DOCS} 篇，用 search_memory 找）`]
    : [];
  const you = youBody(state);
  return [HEADER, HINT, '### 目录', ...directoryLines(docs.slice(0, DIRECTORY_MAX_DOCS)), ...more,
    ...(you.length === 0 ? [] : ['### 关于你', ...you])].join('\n');
}

const JOURNAL_LABELS: Readonly<Record<MemoryJournalKind, string>> = { fact: '事实', decision: '决定',
  correction: '纠正', done: '做成', remembered: '记住' };
const TODAY_HEADER = '## 今天的记录（白天每轮记下的短记录，夜里才整理进主题文档；和主题文档冲突时以这里新的为准）';

/** 白天的「今天的记录」：还没整理的，最近的放得下就装，装不下的写明还有几条。没有就是空的。 */
export function todaySection(state: TodayState): string {
  const entries = state.memoryJournal.open();
  if (entries.length === 0) {
    return '';
  }
  const shown: string[] = [];
  let used = 0;
  for (const entry of [...entries].reverse()) {
    const text = `- [${JOURNAL_LABELS[entry.kind]}] ${entry.text}`;
    used += estimateTokens(text);
    if (used > TODAY_BUDGET_TOKENS) {
      break;
    }
    shown.unshift(text);
  }
  const left = entries.length - shown.length;
  return [TODAY_HEADER, ...(left > 0 ? [`（更早的 ${left} 条这次没装）`] : []), ...shown].join('\n');
}

/** 按名字找一篇（目录里写的是名字）：先全同，再去掉空白和大小写；也认标识。 */
export function findDoc(state: DocsState, nameOrId: string): MemoryDoc | undefined {
  const live = state.memoryDocs.docs.live();
  const key = nameOrId.trim() === '怎么替你做事' ? RULES_DOC_ID : nameOrId.trim();
  const loose = (text: string) => text.replace(/\s+/g, '').toLowerCase();
  return live.find((doc) => doc.id === key) ?? live.find((doc) => doc.title === key)
    ?? live.find((doc) => loose(doc.title) === loose(key));
}

const RULES_HEADER = '## 主线的 Soul（所有队友共用；系统默认、用户原话和已确认推断按真实来源标记）';
const RULES_HINT = '照这些规矩做事，不用再问他一遍；和他这次说的冲突时以最新的为准，后台整理会改那一行。';

/**
 * 「怎么替你做事」整份（第 4 批）：硬线在最前面，然后是在用的每一行，不设预算、不截（文档本身有字数上限，满了合并）。
 * 一行都还没有时也带硬线。行带标识，整理和 ≠ 能对上是哪一行。
 */
export function rulesDocSection(state: Pick<StateService, 'memoryDocs'>): string {
  const hard = `硬线（不管有没有把握都先问用户；代码里也拦着）：${hardLinesForModel().join('；')}。`;
  const live = state.memoryDocs.docs.get(RULES_DOC_ID) === undefined ? [] : state.memoryDocs.lines.live(RULES_DOC_ID);
  const lines = SOUL_SECTIONS.flatMap((section) => {
    const group = live.filter((line) => soulSectionOf(state, line) === section);
    return group.length === 0 ? [] : [`### ${SOUL_SECTION_LABELS[section]}`, ...group.map((line) => lineText({ ...line, previous: null }))];
  });
  return [RULES_HEADER, RULES_HINT, hard, ...lines].join('\n');
}

export interface MemoryLineHit {
  docId: string;
  docTitle: string;
  line: MemoryLine;
  score: number;
}

/**
 * 跨文档按两字重合搜行，最像的在前；文档标题或说明对上了，它的行也加分。默认只搜现行；archive 时连归档一起搜
 * （他问「以前怎么定的」）。删除的哪里都搜不到。
 */
export function searchMemory(state: DocsState, query: string, limit = SEARCH_DEFAULT_LIMIT,
  archive = false): MemoryLineHit[] {
  const docs = new Map(state.memoryDocs.docs.live().map((doc) => [doc.id, doc]));
  const hits: MemoryLineHit[] = [];
  const lines = archive ? [...state.memoryDocs.lines.allLive(), ...state.memoryDocs.lines.allArchived()]
    : state.memoryDocs.lines.allLive();
  for (const line of lines) {
    const doc = docs.get(line.docId);
    if (doc === undefined) {
      continue;
    }
    const score = similarity(line.text, query) + similarity(`${doc.title}${doc.summary}`, query) / 2;
    if (score > 0) {
      hits.push({ docId: doc.id, docTitle: doc.title, line, score });
    }
  }
  return hits.sort((a, b) => b.score - a.score).slice(0, limit);
}

/** 一份文档给模型读的样子：说明、在用的行（决定段在前），需要时带归档（被取代的旧说法、过时的事实）。 */
export function memoryDocView(state: DocsState, doc: MemoryDoc, includeRetired = false) {
  const lines = state.memoryDocs.lines.live(doc.id);
  const view = (line: MemoryLine) => ({ id: line.id, section: line.section, text: line.text, basis: line.basis,
    previous: line.previous, anchors: line.anchors });
  return {
    id: doc.id,
    kind: doc.kind,
    title: doc.title,
    summary: doc.summary,
    projectId: doc.projectId,
    decisions: lines.filter((line) => line.section === 'decision').map(view),
    lines: lines.filter((line) => line.section !== 'decision').map(view),
    ...(includeRetired ? { archived: state.memoryDocs.lines.archived(doc.id).map((line) => ({ ...view(line),
      archivedAt: line.archivedAt, retiredReason: line.retiredReason })) } : {}),
  };
}
