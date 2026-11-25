import {
  MEMORY_DOC_SUMMARY_MAX_CHARS,
  MEMORY_DOC_TITLE_MAX_CHARS,
  MEMORY_LINE_MAX_CHARS,
  type MemoryDoc,
  type MemoryLine,
} from '../../../shared/state.ts';
import { looksLikeSecret, normalized, sameThing } from '../curation/memory-curation-ops.ts';
import { addLine, docEvent, reviseLine, type DocState, type Writer } from './memory-doc-writes.ts';
import { siteKey } from '../../state/index.ts';

export interface ExperienceInput {
  topic: string;
  summary?: string;
  section: 'do' | 'avoid';
  text: string;
  lineId: string;
  replacesLineId?: string;
  sites?: readonly string[];
}

export type ExperienceResult =
  | { saved: true; line: MemoryLine; doc: MemoryDoc; created: boolean }
  | { saved: false; reason: string };

function clip(text: string, max: number): string {
  return Array.from(text.trim()).slice(0, max).join('');
}

export function findHowDoc(state: DocState, topic: string, sites?: readonly string[]): MemoryDoc | undefined {
  const key = normalized(topic);
  const docs = state.memoryDocs.docs.live().filter((doc) => doc.kind === 'how');
  const titled = docs.find((doc) => normalized(doc.title) === key);
  if (titled !== undefined || sites === undefined) {
    return titled;
  }
  const keys = [...new Set(sites.map(siteKey).filter((site) => site !== ''))];
  const [first] = state.memoryDocs.usage.docsFor('how', keys);
  return first === undefined ? undefined : docs.find((doc) => doc.id === first);
}

export function noteExperience(state: DocState, input: ExperienceInput, writer: Writer): ExperienceResult {
  const topic = clip(input.topic, MEMORY_DOC_TITLE_MAX_CHARS);
  const text = clip(input.text, MEMORY_LINE_MAX_CHARS);
  if (topic === '' || text === '') {
    return { saved: false, reason: '要写清是哪个工具、网站或流程，和这条经验本身' };
  }
  if (looksLikeSecret(text)) {
    return { saved: false, reason: '像密钥，不记' };
  }
  return state.transaction((): ExperienceResult => {
    const result = writeExperience(state, input, topic, text, writer);
    const doc = result.saved ? result.doc : findHowDoc(state, topic, input.sites);
    if (doc !== undefined && input.sites !== undefined) {
      state.memoryDocs.usage.addSites(doc.id, input.sites);
    }
    return result;
  });
}

function writeExperience(state: DocState, input: ExperienceInput, topic: string, text: string, writer: Writer)
  : ExperienceResult {
  const anchors = [{ kind: 'work' as const, ref: `line:${input.lineId}` }];
  const existing = findHowDoc(state, topic, input.sites);
  if (input.replacesLineId !== undefined) {
    const old = state.memoryDocs.lines.get(input.replacesLineId);
    if (old === undefined || old.retiredAt !== null || existing === undefined || old.docId !== existing.id) {
      return { saved: false, reason: '要改的那一行不在这一篇在用的行里' };
    }
    if (normalized(old.text) === normalized(text)) {
      return { saved: false, reason: '和原来一样' };
    }
    return { saved: true, doc: existing, created: false, line: reviseLine(state, old, text, anchors, writer) };
  }
  if (existing !== undefined
    && state.memoryDocs.lines.live(existing.id).some((line) => sameThing(line.text, text))) {
    return { saved: false, reason: '这条已经记过' };
  }
  const doc = existing ?? state.memoryDocs.docs.create({ kind: 'how', title: topic,
    summary: clip(input.summary ?? `做「${topic}」这类事的做法和坑；动手之前读`, MEMORY_DOC_SUMMARY_MAX_CHARS),
    createdBy: writer.actor });
  if (existing === undefined) {
    docEvent(state, doc.id, null, 'doc_created', writer, { title: doc.title });
  }
  const line = addLine(state, { docId: doc.id, section: input.section, text, basis: 'tried', anchors }, writer);
  return { saved: true, doc, created: existing === undefined, line };
}
