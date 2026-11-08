// 后台整理的操作：模型提，代码校验后才落库（docs/specs/memory-docs.md 第 3 节）。校验是纯函数，逐条给拒绝理由：
// 用户说的（加 / 改 / 退休 / 重说）必须引用这一次真实的来源（对话轮 = 这一轮的用户消息，迁移 = 这一批里用户原话的旧条目）；
// 推断只能进待确认；重复不加（并记一次用户重说）；决定段只在项目文档；项目文档只由项目生成。

import { Type, type Static } from 'typebox';
import {
  MEMORY_DOC_SUMMARY_MAX_CHARS,
  MEMORY_DOC_TITLE_MAX_CHARS,
  MEMORY_LINE_MAX_CHARS,
  MEMORY_LINE_SECTIONS,
  MEMORY_NEW_DOC_KINDS,
  type MemoryAnchor,
  type MemoryDoc,
  type MemoryDocKind,
  type MemoryInference,
  type MemoryLine,
  type MemoryLineSection,
  type MemoryNewDocKind,
} from '../../shared/state.ts';

// 一次回答最多看这么多条操作；一轮对话里值得记的事不会更多，多出来的多半是模型在凑数。
export const MAX_OPS = 40;
// 去标点后两字重合（交集 / 并集）到这个比例就算同一件事。
export const DUPLICATE_SIMILARITY = 0.8;

const Str = Type.Optional(Type.String());
/** 模型给的一条操作。字段都放宽成可选，缺什么、超长了逐条拒绝，不因为一条不合格丢掉整次回答。 */
export const CurationOpSchema = Type.Object({
  op: Type.Enum(['add', 'revise', 'retire', 'new_doc', 'summary', 'infer', 'restated']),
  doc: Str,
  line: Str,
  ref: Str,
  kind: Str,
  title: Str,
  summary: Str,
  section: Str,
  text: Str,
  why: Str,
  forget: Type.Optional(Type.Boolean()),
  sources: Type.Optional(Type.Array(Type.String())),
});
export type CurationOp = Static<typeof CurationOpSchema>;
export const CurationOutputSchema = Type.Object({
  ops: Type.Array(CurationOpSchema),
  used: Type.Optional(Type.Array(Type.String())),
});
export type CurationOutput = Static<typeof CurationOutputSchema>;

/** 这一次可以引用的来源：标识 → 写进行里的锚点，以及它算不算用户说的。 */
export interface CurationSource {
  anchors: MemoryAnchor[];
  stated: boolean;
}

export interface CurationSnapshot {
  docs: readonly MemoryDoc[];
  lines: readonly MemoryLine[];
  pending: readonly MemoryInference[];
  sources: ReadonlyMap<string, CurationSource>;
}

/** 文档要么是已有的标识，要么是这次 new_doc 的 ref。 */
export type DocTarget = { id: string } | { ref: string };

export type PlannedOp =
  | { kind: 'new_doc'; ref: string; docKind: MemoryNewDocKind; title: string; summary: string }
  | { kind: 'add'; doc: DocTarget; section: MemoryLineSection; text: string; anchors: MemoryAnchor[] }
  | { kind: 'revise'; line: MemoryLine; text: string; anchors: MemoryAnchor[] }
  | { kind: 'retire'; line: MemoryLine; reason: 'forgotten' | 'no_longer_true'; sourceIds: string[] }
  | { kind: 'summary'; docId: string; summary: string }
  | { kind: 'infer'; doc: DocTarget; section: MemoryLineSection; text: string; why: string; anchors: MemoryAnchor[] }
  | { kind: 'restated'; line: MemoryLine; sourceId: string };

export interface Rejection {
  op: string;
  reason: string;
}

export interface CurationPlan {
  ops: PlannedOp[];
  rejected: Rejection[];
  used: string[];
}

// 各家令牌的固定前缀和私钥块（同 scripts/scan-tests.ts）：密钥不进记忆，按现有规矩，这里不新增放宽。
const SECRET_SHAPES = [
  /\bsk-(?:proj-)?[A-Za-z0-9_-]{32,}/,
  /\b(?:ghp|gho|ghu|ghs|ghr|github_pat)_[A-Za-z0-9_]{30,}/,
  /\bAKIA[0-9A-Z]{16}\b/,
  /\bAIza[0-9A-Za-z_-]{35}\b/,
  /\bxox[abpr]-[A-Za-z0-9-]{20,}/,
  /-----BEGIN (?:RSA |EC |OPENSSH |)PRIVATE KEY-----/,
];

export function looksLikeSecret(text: string): boolean {
  return SECRET_SHAPES.some((pattern) => pattern.test(text));
}

/** 去掉空白和标点、转小写：判断「同一句话」用。 */
export function normalized(text: string): string {
  return text.toLowerCase().replace(/[\s\p{P}\p{S}]/gu, '');
}

function bigrams(text: string): Set<string> {
  const chars = Array.from(normalized(text));
  const found = new Set<string>();
  for (let index = 0; index + 1 < chars.length; index += 1) {
    found.add(`${chars[index] ?? ''}${chars[index + 1] ?? ''}`);
  }
  if (chars.length === 1) {
    found.add(chars[0] ?? '');
  }
  return found;
}

/** 两段文字的两字重合：交集 / 并集，0 到 1。 */
export function similarity(a: string, b: string): number {
  const left = bigrams(a);
  const right = bigrams(b);
  if (left.size === 0 || right.size === 0) {
    return 0;
  }
  let shared = 0;
  for (const gram of left) {
    if (right.has(gram)) {
      shared += 1;
    }
  }
  return shared / (left.size + right.size - shared);
}

export function sameThing(a: string, b: string): boolean {
  return normalized(a) === normalized(b) || similarity(a, b) >= DUPLICATE_SIMILARITY;
}

function distinctAnchors(anchors: readonly MemoryAnchor[]): MemoryAnchor[] {
  const seen = new Set<string>();
  const kept: MemoryAnchor[] = [];
  for (const anchor of anchors) {
    const key = `${anchor.kind}:${anchor.ref}`;
    if (!seen.has(key)) {
      seen.add(key);
      kept.push(anchor);
    }
  }
  return kept;
}

function label(op: CurationOp): string {
  return [op.op, op.doc ?? op.line ?? op.ref ?? ''].filter((part) => part !== '').join(':');
}

class Planner {
  readonly #snapshot: CurationSnapshot;
  readonly #docs = new Map<string, MemoryDoc>();
  readonly #lines = new Map<string, MemoryLine>();
  /** new_doc 的 ref → 新文档的种类，或已有同名文档的标识。 */
  readonly #refs = new Map<string, { kind: MemoryDocKind; existing: string | null }>();
  readonly #touched = new Set<string>();
  readonly #restated = new Set<string>();
  /** 这次已接受的加行和推断（按文档），后面的重复也要拦。 */
  readonly #planned = new Map<string, string[]>();
  readonly plan: CurationPlan = { ops: [], rejected: [], used: [] };

  constructor(snapshot: CurationSnapshot) {
    this.#snapshot = snapshot;
    for (const doc of snapshot.docs) {
      this.#docs.set(doc.id, doc);
    }
    for (const line of snapshot.lines) {
      this.#lines.set(line.id, line);
    }
  }

  take(op: CurationOp): void {
    const reason = this.#accept(op);
    if (reason !== null) {
      this.plan.rejected.push({ op: label(op), reason });
    }
  }

  takeUsed(ids: readonly string[]): void {
    this.plan.used = [...new Set(ids)].filter((id) => this.#lines.has(id));
  }

  #accept(op: CurationOp): string | null {
    switch (op.op) {
      case 'new_doc':
        return this.#newDoc(op);
      case 'summary':
        return this.#summary(op);
      case 'add':
        return this.#add(op);
      case 'infer':
        return this.#infer(op);
      case 'revise':
        return this.#revise(op);
      case 'retire':
        return this.#retire(op);
      case 'restated':
        return this.#restatedOp(op);
    }
  }

  #text(raw: string | undefined, max: number): string | { error: string } {
    const text = (raw ?? '').trim();
    if (text === '') {
      return { error: '没有文字' };
    }
    if (Array.from(text).length > max) {
      return { error: `超过 ${max} 字` };
    }
    if (looksLikeSecret(text)) {
      return { error: '像密钥，不记' };
    }
    return text;
  }

  /** 引用的来源都要是这一次的真实来源；`stated` 时还得都是用户说的。 */
  #sources(op: CurationOp, stated: boolean): { ids: string[]; anchors: MemoryAnchor[] } | { error: string } {
    const ids = [...new Set(op.sources ?? [])];
    if (ids.length === 0) {
      return { error: '没有引用来源' };
    }
    const anchors: MemoryAnchor[] = [];
    for (const id of ids) {
      const source = this.#snapshot.sources.get(id);
      if (source === undefined) {
        return { error: `来源 ${id} 不是这一次的用户原话` };
      }
      if (stated && !source.stated) {
        return { error: `来源 ${id} 是推测，只能进拿不准的` };
      }
      anchors.push(...source.anchors);
    }
    return { ids, anchors: distinctAnchors(anchors) };
  }

  #target(raw: string | undefined): { target: DocTarget; kind: MemoryDocKind; key: string } | { error: string } {
    const doc = raw === undefined ? undefined : this.#docs.get(raw);
    if (doc !== undefined) {
      return { target: { id: doc.id }, kind: doc.kind, key: doc.id };
    }
    const ref = raw === undefined ? undefined : this.#refs.get(raw);
    if (raw !== undefined && ref !== undefined) {
      return ref.existing === null ? { target: { ref: raw }, kind: ref.kind, key: `ref:${raw}` }
        : { target: { id: ref.existing }, kind: ref.kind, key: ref.existing };
    }
    return { error: `没有文档 ${raw ?? '（没写）'}` };
  }

  #section(raw: string | undefined, kind: MemoryDocKind): MemoryLineSection | { error: string } {
    const section = MEMORY_LINE_SECTIONS.find((known) => known === (raw ?? 'note'));
    if (section === undefined) {
      return { error: `没有段 ${raw ?? ''}` };
    }
    if (section === 'decision' && kind !== 'project') {
      return { error: '决定段只在项目文档里' };
    }
    return section;
  }

  #newDoc(op: CurationOp): string | null {
    if (op.ref === undefined || op.ref === '' || this.#refs.has(op.ref) || this.#docs.has(op.ref)) {
      return 'new_doc 要一个这次没用过的 ref';
    }
    const kind = MEMORY_NEW_DOC_KINDS.find((candidate) => candidate === op.kind);
    if (kind === undefined) {
      return '只能新建人物、话题或技能文档（关于你只有一份，项目文档由项目生成）';
    }
    const title = this.#text(op.title, MEMORY_DOC_TITLE_MAX_CHARS);
    const summary = this.#text(op.summary, MEMORY_DOC_SUMMARY_MAX_CHARS);
    if (typeof title !== 'string') {
      return `标题不合格：${title.error}`;
    }
    if (typeof summary !== 'string') {
      return `说明不合格：${summary.error}`;
    }
    const same = [...this.#docs.values()].find((doc) => normalized(doc.title) === normalized(title));
    if (same !== undefined) {
      // 同名的文档已经有了：这次的 ref 就指它，不另建一份。
      this.#refs.set(op.ref, { kind: same.kind, existing: same.id });
      return null;
    }
    this.#refs.set(op.ref, { kind, existing: null });
    this.plan.ops.push({ kind: 'new_doc', ref: op.ref, docKind: kind, title, summary });
    return null;
  }

  #summary(op: CurationOp): string | null {
    const doc = op.doc === undefined ? undefined : this.#docs.get(op.doc);
    if (doc === undefined) {
      return `没有文档 ${op.doc ?? ''}`;
    }
    const summary = this.#text(op.summary, MEMORY_DOC_SUMMARY_MAX_CHARS);
    if (typeof summary !== 'string') {
      return summary.error;
    }
    this.plan.ops.push({ kind: 'summary', docId: doc.id, summary });
    return null;
  }

  #duplicateIn(key: string, docId: string | null, text: string): MemoryLine | 'planned' | null {
    if (docId !== null) {
      const line = this.#snapshot.lines.find((row) => row.docId === docId && sameThing(row.text, text));
      if (line !== undefined) {
        return line;
      }
    }
    return (this.#planned.get(key) ?? []).some((planned) => sameThing(planned, text)) ? 'planned' : null;
  }

  #add(op: CurationOp): string | null {
    const target = this.#target(op.doc);
    if ('error' in target) {
      return target.error;
    }
    const section = this.#section(op.section, target.kind);
    const text = this.#text(op.text, MEMORY_LINE_MAX_CHARS);
    const sources = this.#sources(op, true);
    if (typeof section !== 'string') {
      return section.error;
    }
    if (typeof text !== 'string') {
      return text.error;
    }
    if ('error' in sources) {
      return sources.error;
    }
    const docId = 'id' in target.target ? target.target.id : null;
    const duplicate = this.#duplicateIn(target.key, docId, text);
    if (duplicate !== null) {
      if (duplicate !== 'planned') {
        this.#markRestated(duplicate, sources.ids[0] ?? '');
      }
      return '已经记过（算一次用户重说）';
    }
    this.#planned.set(target.key, [...(this.#planned.get(target.key) ?? []), text]);
    this.plan.ops.push({ kind: 'add', doc: target.target, section, text, anchors: sources.anchors });
    return null;
  }

  #infer(op: CurationOp): string | null {
    const target = this.#target(op.doc);
    if ('error' in target) {
      return target.error;
    }
    const section = this.#section(op.section, target.kind);
    const text = this.#text(op.text, MEMORY_LINE_MAX_CHARS);
    const sources = this.#sources(op, false);
    if (typeof section !== 'string') {
      return section.error;
    }
    if (typeof text !== 'string') {
      return text.error;
    }
    if ('error' in sources) {
      return sources.error;
    }
    const docId = 'id' in target.target ? target.target.id : null;
    const pending = this.#snapshot.pending.some((row) => row.docId === docId && sameThing(row.text, text));
    if (pending || this.#duplicateIn(target.key, docId, text) !== null) {
      return '已经记过或已经在拿不准的里';
    }
    this.#planned.set(target.key, [...(this.#planned.get(target.key) ?? []), text]);
    const why = Array.from((op.why ?? '').trim()).slice(0, 1_000).join('');
    this.plan.ops.push({ kind: 'infer', doc: target.target, section, text, why, anchors: sources.anchors });
    return null;
  }

  #line(raw: string | undefined): MemoryLine | { error: string } {
    const line = raw === undefined ? undefined : this.#lines.get(raw);
    if (line === undefined) {
      return { error: `没有在用的行 ${raw ?? ''}` };
    }
    if (this.#touched.has(line.id)) {
      return { error: '这一行这次已经改过或退休过' };
    }
    return line;
  }

  #revise(op: CurationOp): string | null {
    const line = this.#line(op.line);
    const text = this.#text(op.text, MEMORY_LINE_MAX_CHARS);
    const sources = this.#sources(op, true);
    if ('error' in line) {
      return line.error;
    }
    if (typeof text !== 'string') {
      return text.error;
    }
    if ('error' in sources) {
      return sources.error;
    }
    if (normalized(text) === normalized(line.text)) {
      this.#markRestated(line, sources.ids[0] ?? '');
      return '和原来一样（算一次用户重说）';
    }
    this.#touched.add(line.id);
    this.plan.ops.push({ kind: 'revise', line, text, anchors: sources.anchors });
    return null;
  }

  #retire(op: CurationOp): string | null {
    const line = this.#line(op.line);
    const sources = this.#sources(op, true);
    if ('error' in line) {
      return line.error;
    }
    if ('error' in sources) {
      return sources.error;
    }
    this.#touched.add(line.id);
    const reason = op.forget === true ? 'forgotten' : 'no_longer_true';
    this.plan.ops.push({ kind: 'retire', line, reason, sourceIds: sources.ids });
    return null;
  }

  #restatedOp(op: CurationOp): string | null {
    const line = op.line === undefined ? undefined : this.#lines.get(op.line);
    const sources = this.#sources(op, true);
    if (line === undefined) {
      return `没有在用的行 ${op.line ?? ''}`;
    }
    if ('error' in sources) {
      return sources.error;
    }
    this.#markRestated(line, sources.ids[0] ?? '');
    return null;
  }

  /**
   * 同一次整理里同一行只记一次重说。这一行本来就链着这句话（对话里 remember_conversation 当场记过，之后后台整理
   * 又看到同一句）不是用户重说，不记。
   */
  #markRestated(line: MemoryLine, sourceId: string): void {
    const anchors = this.#snapshot.sources.get(sourceId)?.anchors ?? [];
    const already = anchors.some((anchor) => line.anchors.some((own) => own.kind === anchor.kind
      && own.ref === anchor.ref));
    if (this.#restated.has(line.id) || already) {
      return;
    }
    this.#restated.add(line.id);
    this.plan.ops.push({ kind: 'restated', line, sourceId });
  }
}

/** 模型的回答 → 能落库的操作和逐条拒绝理由。不读库、不写库。 */
export function planCuration(output: CurationOutput, snapshot: CurationSnapshot): CurationPlan {
  const planner = new Planner(snapshot);
  for (const op of output.ops.slice(0, MAX_OPS)) {
    planner.take(op);
  }
  for (const op of output.ops.slice(MAX_OPS)) {
    planner.plan.rejected.push({ op: label(op), reason: `一次最多 ${MAX_OPS} 条操作` });
  }
  planner.takeUsed(output.used ?? []);
  return planner.plan;
}
