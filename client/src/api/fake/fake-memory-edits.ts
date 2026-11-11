// 假记忆的改、删、加、挪和全量整理（11-11 第 11 批）：和真服务端一样按版本改，改过的行版本加一；删掉的行从页里拿掉；
// 挪过去接在目标页最后一节。全量整理在假实现里马上出一份示例清单（合并、挪位置、归档各一条），勾了才改。

import { ApiError } from '../errors.ts';
import type { ApplyCleanupResponse, CleanupItemView, CleanupView, LatestCleanupResponse } from '../shared.ts';
import type { LineSeed, TopicSeed } from './memory-topics-seed.ts';

export interface LineRef {
  seed: TopicSeed;
  section: TopicSeed['sections'][number];
  line: LineSeed;
}

function conflict(message: string): ApiError {
  return new ApiError({ kind: 'conflict', code: 'version_conflict', status: 409, message });
}

export class FakeMemoryEdits {
  private readonly meta = new WeakMap<LineSeed, { id: string; version: number }>();
  private counter = 0;
  private cleanup: CleanupView | null = null;
  private overview: LatestCleanupResponse['overview'] = null;

  private readonly topics: () => TopicSeed[];
  private readonly now: () => Date;

  constructor(topics: () => TopicSeed[], now: () => Date) {
    this.topics = topics;
    this.now = now;
  }

  /** 种子行按位置给个稳定的标识（和以前一样的形状），之后加的行另起。 */
  label(): void {
    for (const seed of this.topics()) {
      seed.sections.forEach((section, si) => section.lines.forEach((line, li) => {
        if (!this.meta.has(line)) this.meta.set(line, { id: `${seed.topic.id}_s${si}_l${li}`, version: 1 });
      }));
    }
  }

  metaOf = (line: LineSeed): { id: string; version: number } | undefined => this.meta.get(line);

  find(lineId: string): LineRef | undefined {
    for (const seed of this.topics()) {
      for (const section of seed.sections) {
        const line = section.lines.find((candidate) => this.meta.get(candidate)?.id === lineId);
        if (line !== undefined) return { seed, section, line };
      }
    }
    return undefined;
  }

  private require(docId: string, lineId: string, version: number): LineRef {
    const found = this.find(lineId);
    if (found === undefined || found.seed.topic.id !== docId) {
      throw new ApiError({ kind: 'not_found', code: 'not_found', status: 404, message: '这一行已经不在了。' });
    }
    if (this.meta.get(found.line)!.version !== version) throw conflict('这一行在别处改过了，这次没有改。');
    return found;
  }

  private doc(docId: string): TopicSeed {
    const seed = this.topics().find((candidate) => candidate.topic.id === docId);
    if (seed === undefined) {
      throw new ApiError({ kind: 'not_found', code: 'not_found', status: 404, message: '没有这一页记忆。' });
    }
    return seed;
  }

  private touch(seed: TopicSeed): void {
    seed.topic = { ...seed.topic, updatedAt: this.now().toISOString(),
      lineCount: seed.sections.reduce((sum, section) => sum + section.lines.length, 0) };
  }

  private append(seed: TopicSeed, line: LineSeed, version = 1): string {
    let section = seed.sections[seed.sections.length - 1];
    if (section === undefined) {
      section = { heading: '补充', lines: [] };
      seed.sections.push(section);
    }
    section.lines.push(line);
    const id = `line_new_${(this.counter += 1)}`;
    this.meta.set(line, { id, version });
    this.touch(seed);
    return id;
  }

  add(docId: string, text: string): string {
    return this.append(this.doc(docId), [text.trim(), 'quote', '你加的', 0]);
  }

  edit(docId: string, lineId: string, version: number, text: string): void {
    const found = this.require(docId, lineId, version);
    found.line[0] = text.trim();
    found.line[1] = 'quote';
    found.line[2] = '你改的';
    found.line[3] = 0;
    this.meta.set(found.line, { id: lineId, version: version + 1 });
    this.touch(found.seed);
  }

  retire(docId: string, lineId: string, version: number): void {
    const found = this.require(docId, lineId, version);
    found.section.lines.splice(found.section.lines.indexOf(found.line), 1);
    this.touch(found.seed);
  }

  move(docId: string, lineId: string, version: number, toDocId: string): string {
    const target = this.doc(toDocId);
    const found = this.require(docId, lineId, version);
    found.section.lines.splice(found.section.lines.indexOf(found.line), 1);
    this.touch(found.seed);
    return this.append(target, [...found.line] as LineSeed);
  }

  // ---- 全量整理 ----

  latest(): LatestCleanupResponse {
    return { cleanup: structuredClone(this.cleanup), overview: structuredClone(this.overview) };
  }

  private lineView(lineId: string): CleanupItemView['lines'][number] | null {
    const found = this.find(lineId);
    return found === undefined ? null
      : { id: lineId, text: found.line[0], docId: found.seed.topic.id, docTitle: found.seed.topic.title };
  }

  /** 示例清单：拿现有的几行出合并、挪位置、归档各一条。 */
  start(): CleanupView {
    const at = this.now().toISOString();
    const pick = (docId: string, index: number) => {
      const seed = this.topics().find((candidate) => candidate.topic.id === docId);
      const line = seed?.sections.flatMap((section) => section.lines)[index];
      return line === undefined ? null : this.meta.get(line)?.id ?? null;
    };
    const items: CleanupItemView[] = [];
    const add = (item: Omit<CleanupItemView, 'id' | 'lines' | 'applied' | 'toDocTitle'>, ids: (string | null)[]) => {
      const lines = ids.flatMap((id) => (id === null ? [] : [this.lineView(id)].filter((line) => line !== null)));
      if (lines.length !== ids.length || lines.length === 0) return;
      const toDocTitle = item.toDocId === null ? null
        : this.topics().find((seed) => seed.topic.id === item.toDocId)?.topic.title ?? null;
      items.push({ ...item, id: `item_${items.length + 1}`, lines, applied: null, toDocTitle });
    };
    add({ kind: 'move', toDocId: 't_you', text: null, reason: '「个人」不是项目，是你的生活信息' }, [pick('t_personal', 0)]);
    add({ kind: 'merge', toDocId: null, text: '工作日晚上写代码，周末不排工作提醒。', reason: '两条说的是一回事' },
      [pick('t_you', 0), pick('t_you', 1)]);
    add({ kind: 'archive', toDocId: null, text: null, reason: '已经做完了' }, [pick('t_plasticine', 0)]);
    this.cleanup = { id: `cleanup_${(this.counter += 1)}`, version: 1, status: 'ready', error: null, items,
      createdAt: at, finishedAt: at };
    this.overview = { text: 'Alex，独立开发 Plasticine 和 Cyber Hunter；喜欢先给结论、用选择框问。', at };
    return structuredClone(this.cleanup);
  }

  apply(id: string, version: number, chosen: readonly string[]): ApplyCleanupResponse {
    const cleanup = this.cleanup;
    if (cleanup === null || cleanup.id !== id || cleanup.status !== 'ready') throw conflict('这份清单已经处理过了。');
    if (cleanup.version !== version) throw conflict('这份清单在别处改过了。');
    let applied = 0;
    let skipped = 0;
    let stale = 0;
    const items = cleanup.items.map((item) => {
      if (!chosen.includes(item.id)) {
        skipped += 1;
        return { ...item, applied: false };
      }
      const refs = item.lines.map((line) => this.find(line.id));
      if (refs.some((ref) => ref === undefined)) {
        stale += 1;
        return { ...item, applied: false };
      }
      const [first, ...rest] = refs as LineRef[];
      if (item.kind === 'move' && item.toDocId !== null) {
        this.move(first!.seed.topic.id, item.lines[0]!.id, this.meta.get(first!.line)!.version, item.toDocId);
      } else if (item.kind === 'merge' && item.text !== null) {
        for (const ref of rest) ref.section.lines.splice(ref.section.lines.indexOf(ref.line), 1);
        first!.line[0] = item.text;
        this.touch(first!.seed);
      } else if (item.kind === 'add' && item.toDocId !== null && item.text !== null) {
        this.add(item.toDocId, item.text);
      } else {
        for (const ref of refs as LineRef[]) ref.section.lines.splice(ref.section.lines.indexOf(ref.line), 1);
      }
      applied += 1;
      return { ...item, applied: true };
    });
    this.cleanup = { ...cleanup, items, status: 'done', version: cleanup.version + 1 };
    return { cleanup: structuredClone(this.cleanup), applied, skipped, stale };
  }
}
