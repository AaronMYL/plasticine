// 做事经验（记忆分层，11-15 Aaron 定「直接记，能看能撤」）：Plasticine 做事时自己试出来的做法和坑，直接记成做事经验里的
// 一行、下一次就照着做；不用他先点头。每行链回那次做事（work 锚点：哪条线），他在记忆页看得到出处，能改能删。
// 只有这一层允许 Plasticine 自己写；别的层照旧只记他说过的。一个工具、网站或流程一篇，没有就新建。

import {
  MEMORY_DOC_SUMMARY_MAX_CHARS,
  MEMORY_DOC_TITLE_MAX_CHARS,
  MEMORY_LINE_MAX_CHARS,
  type MemoryDoc,
  type MemoryLine,
} from '../../../shared/state.ts';
import { looksLikeSecret, normalized, sameThing } from '../curation/memory-curation-ops.ts';
import { addLine, docEvent, reviseLine, type DocState, type Writer } from './memory-doc-writes.ts';

export interface ExperienceInput {
  /** 哪一篇：工具、网站或流程的名字（「小红书」「发邮件」）。没有这一篇就新建。 */
  topic: string;
  /** 新建这一篇时的一句话说明；不给就用默认的。 */
  summary?: string;
  /** do：走得通的做法；avoid：要避开的坑。 */
  section: 'do' | 'avoid';
  text: string;
  /** 在哪条线上试出来的。 */
  lineId: string;
  /** 同一件事有了新结果：改这一行，旧说法留作「之前」。 */
  replacesLineId?: string;
}

export type ExperienceResult =
  | { saved: true; line: MemoryLine; doc: MemoryDoc; created: boolean }
  | { saved: false; reason: string };

function clip(text: string, max: number): string {
  return Array.from(text.trim()).slice(0, max).join('');
}

function findHowDoc(state: DocState, topic: string): MemoryDoc | undefined {
  const key = normalized(topic);
  return state.memoryDocs.docs.live().find((doc) => doc.kind === 'how' && normalized(doc.title) === key);
}

/** 记一条做事经验。重复的不加；像密钥的不记；改的那一行必须是这一篇里在用的行。 */
export function noteExperience(state: DocState, input: ExperienceInput, writer: Writer): ExperienceResult {
  const topic = clip(input.topic, MEMORY_DOC_TITLE_MAX_CHARS);
  const text = clip(input.text, MEMORY_LINE_MAX_CHARS);
  if (topic === '' || text === '') {
    return { saved: false, reason: '要写清是哪个工具、网站或流程，和这条经验本身' };
  }
  if (looksLikeSecret(text)) {
    return { saved: false, reason: '像密钥，不记' };
  }
  const anchors = [{ kind: 'work' as const, ref: `line:${input.lineId}` }];
  return state.transaction((): ExperienceResult => {
    const existing = findHowDoc(state, topic);
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
  });
}
