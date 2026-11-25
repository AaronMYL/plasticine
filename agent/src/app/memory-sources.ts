import type { MemoryLineSource } from '../../shared/api/index.ts';
import type { MemoryAnchor } from '../../shared/state.ts';
import { clip } from '../util/index.ts';
import type { StateService } from '../state/index.ts';

export type SourceState = Pick<StateService, 'lineMessages' | 'lines' | 'notes' | 'memory'
  | 'contactMessages'>;

const LABEL_CHARS = 20;
const LINE_TITLE_CHARS = 12;
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
  if (anchor.kind === 'system') {
    return { kind: 'system', id: anchor.ref, label: '系统默认', at: EPOCH };
  }
  if (anchor.kind === 'message') {
    return messageSource(state, anchor.ref);
  }
  if (anchor.kind === 'note') {
    const note = state.notes.get(anchor.ref);
    return { kind: 'note', id: anchor.ref, label: clip(note?.title ?? '笔记', LABEL_CHARS),
      at: note?.updatedAt ?? EPOCH };
  }
  if (anchor.kind === 'agreement' || anchor.kind === 'term') {
    return { kind: 'agreement', id: anchor.ref, label: anchor.kind === 'term' ? '旧词表' : '旧约定', at: EPOCH };
  }
  if (anchor.kind === 'work') {
    const id = anchor.ref.replace(/^line:/u, '');
    const line = state.lines.get(id);
    const label = line === undefined ? '做事的时候' : line.kind === 'main' ? '主线' : clip(line.title, LABEL_CHARS);
    return { kind: 'work', id, label, at: line?.updatedAt ?? EPOCH };
  }
  if (anchor.kind === 'contact_message') {
    const message = state.contactMessages.get(anchor.ref);
    return { kind: 'contact', id: message?.contactId ?? anchor.ref,
      label: message === undefined ? '聊天' : `聊天 · ${dayLabel(message.sentAt)}`, at: message?.sentAt ?? EPOCH };
  }
  if (anchor.kind === 'memory_entry') {
    const entry = state.memory.get(anchor.ref);
    if (entry?.anchor != null && (entry.anchor.kind === 'message' || entry.anchor.kind === 'note')) {
      return sourceOf(state, { kind: entry.anchor.kind, ref: entry.anchor.ref });
    }
    return { kind: 'message', id: anchor.ref, label: '原话', at: entry?.createdAt ?? EPOCH };
  }
  return { kind: 'message', id: anchor.ref, label: '你改的', at: EPOCH };
}

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
