// 假记忆主题（第 102 条）：主题目录按 关于你 · 人 · 项目 · 话题 分组，活文档按需读。拿不准的对 / 不对和真服务端
// 一样由本人会话确认：fake-signed.ts 核实会话、按 requestId 幂等后调 answerSigned。确认过的那一条从目录里拿掉，
// 对应文档那一行不再标「拿不准」；已经定过的再答是 409。
// 第 4 批：「怎么替你做事」和「关于你」同一组；它的文档带硬线。「全部写入」卡答了，没去掉的几条接在规矩后面。

import type { MemoryTopicsApi } from '../things-client.ts';
import { ApiError } from '../errors.ts';
import { groupMemoryTopics, hardLines, RULES_DOC_ID } from '../shared.ts';
import type {
  AnswerUncertainRequest,
  ChooseDreamChangeRequest,
  MemoryDreamChangeView,
  MemoryDreamSummary,
  MemoryDreamView,
  MemorySearchResponse,
  MemoryTopicDoc,
  MemoryTopicListResponse,
  MemoryTopicView,
  RulesOfferItem,
  Tier,
  UncertainItem,
  UndoDreamChangeRequest,
} from '../shared.ts';
import type { FakeReceipts } from './receipts.ts';
import type { FakeSession } from './fake-session.ts';
import { dreamSeed } from './memory-dream-seed.ts';
import { sectionsOf, topicSeeds, uncertainSeeds, type TopicSeed } from './memory-topics-seed.ts';

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

  constructor(deps: FakeMemoryTopicsDeps) {
    this.deps = deps;
  }

  seed(): void {
    const now = this.deps.now();
    this.topics = topicSeeds(now).map((seed) => ({ ...seed, topic: { ...seed.topic,
      lineCount: seed.sections.reduce((sum, section) => sum + section.lines.length, 0) } }));
    this.uncertain = uncertainSeeds(now);
    this.dreamView = dreamSeed(now);
  }

  /** 最近一次整理（首页「回顾」读它数几条）；没有是 null。 */
  currentDream(): MemoryDreamView | null {
    return this.dreamView;
  }

  /** 测试用：还没有夜里的整理（入口整个不出现）。 */
  clearDream(): void {
    this.dreamView = null;
  }

  /** 定档（fake-network.ts 的 FakeVisibility.mark 之后）：目录和文档上的档位跟着变。 */
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
    const topics = this.topics.map((seed) => ({ ...seed.topic,
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
    const sections = sectionsOf(seed, this.deps.now(), idOf).map((section) => ({ ...section,
      lines: section.lines.map((line) => ({ ...line,
        uncertainId: line.uncertainId !== null && open.has(line.uncertainId) ? line.uncertainId : null })) }));
    return { topic: { ...seed.topic, uncertainCount: sections.flatMap((section) => section.lines)
      .filter((line) => line.uncertainId !== null).length }, sections, composedAt: seed.topic.updatedAt, version: 1,
    ...(id === RULES_DOC_ID ? { hardLines: [...hardLines()] } : {}) };
  }

  /** 「全部写入」卡答了（fake-asks 的 onAnswer）：没去掉的几条接在规矩后面。 */
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

  /** 查找用（fake-search.ts）：一份文档一条，文字 = 一句话说明 + 各行。 */
  searchable(): { id: string; updatedAt: string; title: string; text: string }[] {
    return this.topics.map((seed) => ({ id: seed.topic.id, updatedAt: seed.topic.updatedAt, title: seed.topic.title,
      text: [seed.topic.summary, ...seed.sections.flatMap((section) => section.lines.map((line) => line[0]))]
        .join('\n') }));
  }

  /** 本人会话核实之后（fake-signed.ts）。 */
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
