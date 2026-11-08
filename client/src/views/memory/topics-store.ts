// 记忆主题的数据（第 102 条）：目录（关于你 · 人 · 项目 · 话题）和拿不准的；文档点开才读。
// 拿不准的点「对 / 不对」是用户确认字段：和确认约定一样按本人会话发（SignedSender，标识和请求体存在
// signed-ops 里，没了结的那一行就地给「再核实 / 重发」）。点了先在本地收成一行；没拿到结果就放回原样，
// 原因在那一行上；之后重发成功了（signer.onResult → applyAnswered）再收起来。

import type { PlasticineApi } from '../../api/client.ts';
import { errorText } from '../../api/errors.ts';
import type { MemoryDreamChangeView, MemoryDreamView, MemorySearchHit, MemoryTopicDoc, MemoryTopicListResponse,
  MemoryTopicView, Tier, UncertainItem } from '../../api/shared.ts';
import { createRequestId } from '../../api/request-id.ts';
import { Store } from '../../state/store.ts';
import type { LoadStatus } from '../../state/load.ts';
import type { SignedSender } from '../signing/signed-sender.ts';

/** 一条拿不准的确认操作的 key：页面按它找这一行的状态。 */
export function uncertainKey(id: string): string {
  return `memory-uncertain:${id}`;
}

export interface TopicsData {
  status: LoadStatus;
  error: string | null;
  list: MemoryTopicListResponse | null;
  docs: ReadonlyMap<string, MemoryTopicDoc>;
  docError: string | null;
  docErrors: ReadonlyMap<string, string>;
  /** 本地刚答过的（服务端回执前先显示答案）。 */
  answered: ReadonlyMap<string, UncertainItem['status']>;
  /** 「昨晚整理了什么」（第 10、16 条）：读到之前为 null。 */
  dream: MemoryDreamView | null;
  dreamError: string | null;
  /** 撤销 / 挑一个没成的那一条：原因就地显示。 */
  changeErrors: ReadonlyMap<string, string>;
  tierError: string | null;
}

const EMPTY: TopicsData = { status: 'idle', error: null, list: null, docs: new Map(), docError: null,
  docErrors: new Map(), answered: new Map(), dream: null, dreamError: null, changeErrors: new Map(),
  tierError: null };

export class MemoryTopicsStore {
  readonly data = new Store<TopicsData>(EMPTY);
  private readonly api: PlasticineApi;
  private readonly signer: SignedSender;
  private readonly reads = new Map<string, Promise<void>>();

  constructor(api: PlasticineApi, signer: SignedSender) {
    this.api = api;
    this.signer = signer;
  }

  async open(): Promise<void> {
    this.data.set((data) => ({ ...data, status: data.list === null ? 'loading' : data.status, error: null }));
    try {
      const list = await this.api.memoryTopics.list();
      this.data.set((data) => ({ ...data, status: 'ready', list }));
    } catch (cause) {
      this.data.set((data) => ({ ...data, status: 'failed', error: errorText(cause) }));
    }
  }

  openDoc(id: string): Promise<void> {
    const pending = this.reads.get(id);
    if (pending !== undefined) return pending;
    const promise = this.readDoc(id).finally(() => this.reads.delete(id));
    this.reads.set(id, promise);
    return promise;
  }

  private async readDoc(id: string): Promise<void> {
    this.data.set((data) => {
      const docErrors = new Map(data.docErrors);
      docErrors.delete(id);
      return { ...data, docError: null, docErrors };
    });
    try {
      const doc = await this.api.memoryTopics.get(id);
      if (doc.topic.id !== id) throw new Error('读到的记忆不匹配，请重试。');
      this.data.set((data) => ({ ...data, docs: new Map([...data.docs, [id, doc]]) }));
    } catch (cause) {
      const error = errorText(cause);
      this.data.set((data) => ({ ...data, docError: error,
        docErrors: new Map([...data.docErrors, [id, error]]) }));
    }
  }

  async answer(item: UncertainItem, answer: 'yes' | 'no', correction: string | null = null): Promise<void> {
    const status = answer === 'yes' ? 'confirmed' : 'rejected';
    this.data.set((data) => ({ ...data, answered: new Map([...data.answered, [item.id, status]]) }));
    const result = await this.signer.send(uncertainKey(item.id), answer === 'yes' ? '记成对的' : '记成不对',
      item.text, { kind: 'memory_uncertain', uncertainId: item.id },
      (requestId) => ({ requestId, answer, correction }));
    if (result === null) {
      const answered = new Map(this.data.get().answered);
      answered.delete(item.id);
      this.data.set((data) => ({ ...data, answered }));
    }
  }

  /** 搜记忆（页头的搜索框带归档）。 */
  async search(q: string, signal?: AbortSignal): Promise<MemorySearchHit[]> {
    return (await this.api.memoryTopics.search(q, true, signal)).hits;
  }

  async openDream(): Promise<void> {
    this.data.set((data) => ({ ...data, dreamError: null }));
    try {
      const dream = await this.api.memoryTopics.dream();
      this.data.set((data) => ({ ...data, dream }));
    } catch (cause) {
      this.data.set((data) => ({ ...data, dreamError: errorText(cause) }));
    }
  }

  undoChange(change: MemoryDreamChangeView): Promise<void> {
    return this.changeDream(change, () => this.api.memoryTopics.undoDream(change.id,
      { requestId: createRequestId(), version: change.version }));
  }

  chooseChange(change: MemoryDreamChangeView, choice: 0 | 1): Promise<void> {
    return this.changeDream(change, () => this.api.memoryTopics.chooseDream(change.id,
      { requestId: createRequestId(), version: change.version, choice }));
  }

  private async changeDream(change: MemoryDreamChangeView, send: () => Promise<MemoryDreamChangeView>):
    Promise<void> {
    const errors = new Map(this.data.get().changeErrors);
    errors.delete(change.id);
    this.data.set((data) => ({ ...data, changeErrors: errors }));
    try {
      const next = await send();
      this.data.set((data) => ({ ...data, dream: data.dream === null ? null : { ...data.dream,
        changes: data.dream.changes.map((row) => (row.id === next.id ? next : row)) } }));
      this.docs().clear();
    } catch (cause) {
      this.data.set((data) => ({ ...data, changeErrors: new Map([...data.changeErrors,
        [change.id, errorText(cause)]]) }));
    }
  }

  /** 改一篇的档位（第 19 条）：走对外可见的定档，回来后重读目录和这一篇。 */
  async setTier(topic: MemoryTopicView, tier: Tier): Promise<void> {
    this.data.set((data) => ({ ...data, tierError: null }));
    try {
      await this.api.visibility.mark({ requestId: createRequestId(), kind: topic.material.kind, id: topic.material.id,
        tier, version: topic.material.version });
    } catch (cause) {
      this.data.set((data) => ({ ...data, tierError: errorText(cause) }));
      return;
    }
    this.reads.delete(topic.id);
    await Promise.all([this.open(), this.readDoc(topic.id)]);
  }

  /** 夜里整理的撤销改了文档：下次打开时重读。 */
  private docs(): { clear(): void } {
    return { clear: () => this.data.set((data) => ({ ...data, docs: new Map() })) };
  }

  /** 确认请求拿到了结果（第一次发、再核实、重发都一样）：这一条按服务端的答案收起来。 */
  applyAnswered(item: UncertainItem): void {
    this.data.set((data) => ({
      ...data,
      answered: new Map([...data.answered, [item.id, item.status]]),
      list: data.list === null ? null : { ...data.list,
        uncertain: data.list.uncertain.map((row) => (row.id === item.id ? item : row)) },
    }));
  }
}
