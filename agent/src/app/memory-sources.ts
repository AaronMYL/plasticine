// 记忆里一行的出处在界面上怎么写（记忆页的文档、「昨晚整理了什么」共用）：线里他说的话写「主线 · 11月6日」或
// 「「研究周报」· 11月6日」，笔记写标题，约定 / 词表写「约定」「词表」；迁移来的行直接链回它原来的消息或笔记。

import type { MemoryLineSource } from '../../shared/api/index.ts';
import type { MemoryAnchor } from '../../shared/state.ts';
import { clip } from '../shared-text.ts';
import type { StateService } from '../state/index.ts';

export type SourceState = Pick<StateService, 'lineMessages' | 'lines' | 'notes' | 'agreements' | 'memory'>;

const LABEL_CHARS = 20;
const LINE_TITLE_CHARS = 12;
// 出处上的日子按他的时区（他在国内，同 daily 的后台时区）。
const SOURCE_TIME_ZONE = 'Asia/Shanghai';
const EPOCH = new Date(0).toISOString();

function dayLabel(at: string): string {
  const parts = new Intl.DateTimeFormat('zh-CN', { timeZone: SOURCE_TIME_ZONE, month: 'numeric', day: 'numeric' })
    .formatToParts(new Date(at));
  const month = parts.find((part) => part.type === 'month')?.value ?? '';
  const day = parts.find((part) => part.type === 'day')?.value ?? '';
  return `${month}月${day}日`;
}

function messageSource(state: SourceState, ref: string): MemoryLineSource {
  const said = state.lineMessages.said(ref);
  if (said === undefined) {
    return { kind: 'message', id: ref, label: '对话', at: EPOCH };
  }
  const line = state.lines.get(said.lineId);
  const where = line === undefined || line.kind === 'main' ? '主线' : `「${clip(line.title, LINE_TITLE_CHARS)}」`;
  return { kind: 'message', id: ref, label: `${where} · ${dayLabel(said.createdAt)}`, at: said.createdAt };
}

export function sourceOf(state: SourceState, anchor: MemoryAnchor): MemoryLineSource {
  if (anchor.kind === 'message') {
    return messageSource(state, anchor.ref);
  }
  if (anchor.kind === 'note') {
    const note = state.notes.get(anchor.ref);
    return { kind: 'note', id: anchor.ref, label: clip(note?.title ?? '笔记', LABEL_CHARS),
      at: note?.updatedAt ?? EPOCH };
  }
  if (anchor.kind === 'agreement' || anchor.kind === 'term') {
    // 迁进「怎么替你做事」的行指回原来那条约定或词表条目（词表也存在约定表里；两张都不动，点过去只读那一条）。
    const agreement = state.agreements.get(anchor.ref);
    return { kind: 'agreement', id: anchor.ref, label: anchor.kind === 'term' ? '词表' : '约定',
      at: agreement?.createdAt ?? EPOCH };
  }
  if (anchor.kind === 'memory_entry') {
    // 迁移来的行链着整理前的那条原话：界面上直接链回它原来的消息或笔记，不再露出旧记忆条目（2026-11-03）。
    const entry = state.memory.get(anchor.ref);
    if (entry?.anchor != null && (entry.anchor.kind === 'message' || entry.anchor.kind === 'note')) {
      return sourceOf(state, { kind: entry.anchor.kind, ref: entry.anchor.ref });
    }
    return { kind: 'message', id: anchor.ref, label: '原话', at: entry?.createdAt ?? EPOCH };
  }
  return { kind: 'message', id: anchor.ref, label: '你改的', at: EPOCH };
}

/** 一行的来源：同一条消息 / 笔记只列一次（迁移来的行同时链着旧条目和它原来的消息）。 */
export function sourcesOf(state: SourceState, anchors: readonly MemoryAnchor[]): MemoryLineSource[] {
  const seen = new Set<string>();
  const sources: MemoryLineSource[] = [];
  for (const anchor of anchors) {
    const source = sourceOf(state, anchor);
    const key = `${source.kind}:${source.id}`;
    if (!seen.has(key)) {
      seen.add(key);
      sources.push(source);
    }
  }
  return sources;
}
