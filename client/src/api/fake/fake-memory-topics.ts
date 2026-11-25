import type { MemoryTopicsApi } from '../things-client.ts';
import { ApiError } from '../errors.ts';
import {
  GRANTS_DOC_ID, groupMemoryTopics, hardLines, PROACTIVE_DOC_ID, RULES_DOC_ID, type AddMemoryLineRequest,
  type AnswerUncertainRequest, type ApplyCleanupRequest, type ApplyCleanupResponse, type ChooseDreamChangeRequest,
  type EditMemoryLineRequest, type LatestCleanupResponse, type LayersMoveResponse, type LoopGrantView,
  type MemoryDreamChangeView,
  type MemoryDreamSummary, type MemoryDreamView, type MemoryGrantsResponse, type MemorySearchResponse,
  type MemoryTopicDoc, type MemoryTopicListResponse, type MemoryTopicView, type MoveMemoryLineRequest,
  type RetireMemoryLineRequest, type RevokeLoopGrantRequest, type RulesOfferItem, type SoulView,
  type StartCleanupRequest, type Tier, type UncertainItem, type UndoDreamChangeRequest,
  type UndoLayersMoveRequest,
} from '../shared.ts';
import type { WithdrawnLine } from '../things-client.ts';
import type { FakeReceipts } from './receipts.ts';
import type { FakeSession } from './fake-session.ts';
import { dreamSeed } from './memory-dream-seed.ts';
import { sectionsOf, topicSeeds, uncertainSeeds, type TopicSeed } from './memory-topics-seed.ts';
import { FakeMemoryEdits } from './fake-memory-edits.ts';

export interface FakeMemoryTopicsDeps {
  session: FakeSession;
  receipts: FakeReceipts;
  now: () => Date;
}

function conflict(message: string): ApiError {
  return new ApiError({ kind: 'conflict', code: 'conflict', status: 409, message });
}

export class FakeMemoryTopics implements MemoryTopicsApi {
  private readonly deps: FakeMemoryTopicsDeps;
  private topics: TopicSeed[] = [];
  private uncertain: UncertainItem[] = [];
  private dreamView: MemoryDreamView | null = null;
  private loop: LoopGrantView[] = [];
  private moved: { lineId: string; fromDocId: string }[] = [];
  private movedAt: string | null = null;
  readonly edits = new FakeMemoryEdits(() => this.topics, () => this.deps.now());

  constructor(deps: FakeMemoryTopicsDeps) {
    this.deps = deps;
  }

  seed(): void {
    const now = this.deps.now();
    this.topics = topicSeeds(now).map((seed) => ({ ...seed, topic: { ...seed.topic,
      lineCount: seed.sections.reduce((sum, section) => sum + section.lines.length, 0) } }));
    this.uncertain = uncertainSeeds(now);
    this.dreamView = dreamSeed(now);
    this.loop = [{ id: 'loop_feed_save', topic: '把信息流里的文章存进资料库',
      grantedAt: new Date(now.getTime() - 5 * 24 * 3_600_000).toISOString() }];
    this.edits.label();
  }

  applySoul(view: SoulView): void {
    const existing = this.topics.find((row) => row.topic.id === RULES_DOC_ID);
    if (existing === undefined) return;
    existing.topic.title = view.title;
    existing.topic.lineCount = view.lines.length;
    existing.sections = ['speaking', 'doing', 'outbound'].map((section) => ({
      heading: ({ speaking: '说话', doing: '做事', outbound: '对外' } as Record<string, string>)[section] ?? section,
      lines: view.lines.filter((line) => line.section === section).map((line) => [line.text,
        line.source === 'system' ? 'system' : 'quote', line.source === 'system' ? '系统默认' : '你改的',
        Math.max(0, (this.deps.now().getTime() - Date.parse(line.at)) / 60_000)]),
    }));
  }

  currentDream(): MemoryDreamView | null {
    return this.dreamView;
  }

  clearDream(): void {
    this.dreamView = null;
  }

  applyTier(kind: MemoryTopicView['material']['kind'], id: string, tier: Tier, version: number): void {
    this.topics = this.topics.map((seed) => (seed.topic.material.kind === kind && seed.topic.material.id === id
      ? { ...seed, topic: { ...seed.topic, tier, material: { ...seed.topic.material, version } } } : seed));
  }

  private dreamSummary(): MemoryDreamSummary | null {
    const dream = this.dreamView;
    if (dream === null) {
      return null;
    }
    const count = (kind: string) => dream.changes.filter((change) => change.kind === kind).length;
    return { id: dream.id, finishedAt: dream.finishedAt, total: dream.changes.length, add: count('add'),
      replace: count('replace'), unsure: count('unsure'), deadEnd: count('dead_end') };
  }

  async list(): Promise<MemoryTopicListResponse> {
    this.deps.session.require();
    const open = this.uncertain.filter((item) => item.status === 'open');
    const topics = this.topics.map((seed) => ({ ...seed.topic, summary: this.summaryOf(seed),
      uncertainCount: open.filter((item) => item.topicId === seed.topic.id).length }));
    return {
      groups: groupMemoryTopics(topics),
      uncertain: structuredClone(open),
      composedAt: this.latest(),
      dream: this.dreamSummary(),
    };
  }

  async get(id: string): Promise<MemoryTopicDoc> {
    this.deps.session.require();
    const seed = this.topics.find((candidate) => candidate.topic.id === id);
    if (seed === undefined) {
      throw new ApiError({ kind: 'not_found', code: 'not_found', status: 404, message: '没有这一页记忆。' });
    }
    const open = new Set(this.uncertain.filter((item) => item.status === 'open').map((item) => item.id));
    const idOf = (name: string) => this.topics.find((candidate) => candidate.topic.title === name)?.topic.id ?? null;
    const sections = sectionsOf(seed, this.deps.now(), idOf, this.edits.metaOf).map((section) => ({ ...section,
      lines: section.lines.map((line) => ({ ...line,
        uncertainId: line.uncertainId !== null && open.has(line.uncertainId) ? line.uncertainId : null })) }));
    return { topic: { ...seed.topic, uncertainCount: sections.flatMap((section) => section.lines)
      .filter((line) => line.uncertainId !== null).length }, sections, composedAt: seed.topic.updatedAt, version: 1,
    ...(id === RULES_DOC_ID ? { hardLines: [...hardLines()] } : {}) };
  }

  private summaryOf(seed: TopicSeed): string {
    if (seed.topic.id === PROACTIVE_DOC_ID) {
      return '每 30 分钟看 7 件事 · 23:00–08:00 不打扰';
    }
    if (seed.topic.id !== GRANTS_DOC_ID) {
      return seed.topic.summary;
    }
    const counts = seed.sections.flatMap((section) => {
      const count = section.lines.length + (section.section === 'allow' ? this.loop.length : 0);
      return count === 0 ? [] : [`${section.heading} ${count}`];
    });
    return counts.length === 0 ? '还没有说好的事' : counts.join(' · ');
  }

  async addLine(docId: string, input: AddMemoryLineRequest): Promise<void> {
    this.deps.session.require();
    await this.deps.receipts.run('save', input.requestId, `memory-add:${docId}`,
      () => this.edits.add(docId, input.text, input.section));
  }

  async withdrawn(docId: string): Promise<WithdrawnLine[]> {
    this.deps.session.require();
    return this.edits.withdrawn(docId);
  }

  moveLayers(texts: readonly string[], at: Date = this.deps.now()): void {
    const from = this.topics.find((seed) => seed.topic.id === 't_you');
    if (from === undefined) return;
    for (const section of from.sections) {
      for (const line of [...section.lines]) {
        if (!texts.some((text) => line[0].includes(text))) continue;
        const moved = this.edits.metaOf(line);
        if (moved === undefined) continue;
        const lineId = this.edits.move('t_you', moved.id, moved.version, PROACTIVE_DOC_ID, 'never');
        this.moved.push({ lineId, fromDocId: 't_you' });
      }
    }
    this.movedAt = at.toISOString();
  }

  private layersView(): LayersMoveResponse {
    if (this.movedAt === null || Date.now() - Date.parse(this.movedAt) > 7 * 86_400_000) {
      return { move: null };
    }
    const items = this.moved.flatMap((row) => {
      const found = this.edits.find(row.lineId);
      const section = found?.section.section;
      return found === undefined || section === undefined ? [] : [{ lineId: row.lineId, text: found.line[0],
        toDocId: found.seed.topic.id, toTitle: found.seed.topic.title, section,
        fromTitle: this.titleOf(row.fromDocId) }];
    });
    const total = this.topics.reduce((sum, seed) => sum + seed.topic.lineCount, 0);
    return { move: { at: this.movedAt, items, kept: Math.max(0, total - items.length) } };
  }

  async layersMove(): Promise<LayersMoveResponse> {
    this.deps.session.require();
    return this.layersView();
  }

  async undoLayersMove(input: UndoLayersMoveRequest): Promise<LayersMoveResponse> {
    this.deps.session.require();
    return this.deps.receipts.run('save', input.requestId, 'memory-layers-undo', () => {
      const chosen = this.moved.filter((row) => input.lineIds === undefined || input.lineIds.includes(row.lineId));
      for (const row of chosen) {
        const found = this.edits.find(row.lineId);
        const meta = found === undefined ? undefined : this.edits.metaOf(found.line);
        if (found !== undefined && meta !== undefined) {
          this.edits.move(found.seed.topic.id, row.lineId, meta.version, row.fromDocId);
        }
      }
      this.moved = this.moved.filter((row) => !chosen.includes(row));
      return this.layersView();
    });
  }

  async grants(): Promise<MemoryGrantsResponse> {
    this.deps.session.require();
    return { loop: structuredClone(this.loop) };
  }

  async revokeLoopGrant(input: RevokeLoopGrantRequest): Promise<MemoryGrantsResponse> {
    this.deps.session.require();
    return this.deps.receipts.run('save', input.requestId, `memory-loop-revoke:${input.topic}`, () => {
      this.loop = this.loop.filter((grant) => grant.topic !== input.topic);
      return { loop: structuredClone(this.loop) };
    });
  }

  async editLine(docId: string, lineId: string, input: EditMemoryLineRequest): Promise<void> {
    this.deps.session.require();
    await this.deps.receipts.run('save', input.requestId, `memory-edit:${lineId}`,
      () => this.edits.edit(docId, lineId, input.version, input.text));
  }

  async retireLine(docId: string, lineId: string, input: RetireMemoryLineRequest): Promise<void> {
    this.deps.session.require();
    await this.deps.receipts.run('save', input.requestId, `memory-retire:${lineId}`,
      () => this.edits.retire(docId, lineId, input.version, input.mode === 'withdraw'));
  }

  async moveLine(docId: string, lineId: string, input: MoveMemoryLineRequest): Promise<void> {
    this.deps.session.require();
    await this.deps.receipts.run('save', input.requestId, `memory-move:${lineId}`,
      () => this.edits.move(docId, lineId, input.version, input.toDocId, input.section));
  }

  async cleanup(): Promise<LatestCleanupResponse> {
    this.deps.session.require();
    return this.edits.latest();
  }

  async startCleanup(input: StartCleanupRequest): Promise<void> {
    this.deps.session.require();
    await this.deps.receipts.run('save', input.requestId, 'memory-cleanup', () => this.edits.start());
  }

  async applyCleanup(id: string, input: ApplyCleanupRequest): Promise<ApplyCleanupResponse> {
    this.deps.session.require();
    return this.deps.receipts.run('save', input.requestId, `memory-cleanup:${id}`,
      () => this.edits.apply(id, input.version, input.itemIds));
  }

  writeOffer(items: readonly RulesOfferItem[]): void {
    const rules = this.topics.find((seed) => seed.topic.id === RULES_DOC_ID);
    if (rules === undefined) {
      return;
    }
    const section = rules.sections[0];
    if (section === undefined) {
      return;
    }
    section.lines.push(...items.map((item): (typeof section.lines)[number] => [item.text, 'quote', '卡上写入', 0]));
    rules.topic = { ...rules.topic, lineCount: rules.topic.lineCount + items.length,
      updatedAt: this.deps.now().toISOString() };
  }

  searchable(): { id: string; updatedAt: string; title: string; text: string }[] {
    return this.topics.map((seed) => ({ id: seed.topic.id, updatedAt: seed.topic.updatedAt, title: seed.topic.title,
      text: [seed.topic.summary, ...seed.sections.flatMap((section) => section.lines.map((line) => line[0]))]
        .join('\n') }));
  }

  answerSigned(id: string, input: AnswerUncertainRequest): UncertainItem {
    const found = this.uncertain.find((item) => item.id === id);
    if (found === undefined) {
      throw new ApiError({ kind: 'not_found', code: 'not_found', status: 404, message: '这一条已经不在了。' });
    }
    if (found.status !== 'open') {
      throw new ApiError({ kind: 'conflict', code: 'conflict', status: 409,
        message: '这一条已经定过了，这次没有改。' });
    }
    const answered: UncertainItem = { ...found, status: input.answer === 'yes' ? 'confirmed' : 'rejected',
      correction: input.correction };
    this.uncertain = this.uncertain.map((item) => (item.id === id ? answered : item));
    return answered;
  }

  async search(q: string, archive: boolean): Promise<MemorySearchResponse> {
    this.deps.session.require();
    const needle = q.trim().toLowerCase();
    const hits = this.topics.flatMap((seed) => seed.sections.flatMap((section) => section.lines))
      .filter((line) => line[0].toLowerCase().includes(needle));
    const owner = (text: string) => this.topics.find((seed) => seed.sections.some((section) =>
      section.lines.some((line) => line[0] === text)));
    const current = hits.map((line) => ({ topicId: owner(line[0])?.topic.id ?? '', topicTitle:
      owner(line[0])?.topic.title ?? '记忆', lineId: `hit_${line[0]}`, text: line[0], archivedAt: null }));
    const archived = !archive ? [] : (this.dreamView?.changes ?? [])
      .filter((change) => change.previous !== null && change.previous.toLowerCase().includes(needle))
      .map((change) => ({ topicId: change.topicId ?? '', topicTitle: this.titleOf(change.topicId),
        lineId: `old_${change.id}`, text: change.previous ?? '', archivedAt: this.dreamView?.finishedAt ?? null }));
    return { hits: [...current, ...archived] };
  }

  async dream(): Promise<MemoryDreamView> {
    this.deps.session.require();
    if (this.dreamView === null) {
      throw new ApiError({ kind: 'not_found', code: 'not_found', status: 404, message: '还没有昨晚的整理。' });
    }
    return structuredClone(this.dreamView);
  }

  undoDream(id: string, input: UndoDreamChangeRequest): Promise<MemoryDreamChangeView> {
    this.deps.session.require();
    return this.deps.receipts.run('cognition', input.requestId, 'POST /v2/memory/dreams/changes/undo', () =>
      this.changeDream(id, input.version, (change) => {
        if (!change.canUndo) {
          throw conflict('这一条已经撤销过，或者那一行之后又改过了，不能再撤销。');
        }
        return { ...change, undone: true, canUndo: false };
      }));
  }

  chooseDream(id: string, input: ChooseDreamChangeRequest): Promise<MemoryDreamChangeView> {
    this.deps.session.require();
    return this.deps.receipts.run('cognition', input.requestId, 'POST /v2/memory/dreams/changes/choose', () =>
      this.changeDream(id, input.version, (change) => {
        if (change.kind !== 'unsure' || change.chosen !== null) {
          throw conflict('这一条已经定过了，或者没有这个选项。');
        }
        return { ...change, chosen: input.choice === 1 ? 1 : 0 };
      }));
  }

  private changeDream(id: string, version: number,
    edit: (change: MemoryDreamChangeView) => MemoryDreamChangeView): MemoryDreamChangeView {
    const dream = this.dreamView;
    const found = dream?.changes.find((change) => change.id === id);
    if (dream === null || found === undefined) {
      throw new ApiError({ kind: 'not_found', code: 'not_found', status: 404, message: '这一条整理已经不在了。' });
    }
    if (found.version !== version) {
      throw new ApiError({ kind: 'conflict', code: 'version_conflict', status: 409,
        message: '这一条在别处改过了，这次没有改。' });
    }
    const next = { ...edit(found), version: found.version + 1 };
    this.dreamView = { ...dream, changes: dream.changes.map((change) => (change.id === id ? next : change)) };
    return structuredClone(next);
  }

  private titleOf(id: string | null): string {
    return this.topics.find((seed) => seed.topic.id === id)?.topic.title ?? '记忆';
  }

  private latest(): string {
    return this.topics.map((seed) => seed.topic.updatedAt).sort().at(-1) ?? this.deps.now().toISOString();
  }
}
