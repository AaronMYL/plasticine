// 要你定卡的数据（2026-11-05 Harness 重做后）：现在开着的卡（摊开的一张 + 排队的）和暂缓的。卡由线出（硬线、问他），
// 首页「等你」列全部，对话里在等你的那一轮下面摊开。作答、先不都带 requestId；回执丢了就地说一句，再点用同一个标识
// 重发不会答两次。一张卡在哪台设备上答了，ask.answered 到了这边就收起。

import type { PlasticineApi } from '../../api/client.ts';
import { errorText, isUncertain } from '../../api/errors.ts';
import type { EventsHub } from '../../api/events-hub.ts';
import { createRequestId } from '../../api/request-id.ts';
import type { AskView } from '../../api/types.ts';
import type { OutboundGrantInput } from '../../api/shared.ts';
import { Store } from '../../state/store.ts';

export interface AskWork {
  /** 这次作答 / 先不用的标识：没拿到回执时留着，再点用同一个。 */
  requestId: string;
  what: 'answer' | 'defer';
  busy: boolean;
  error: string | null;
}

export interface AsksData {
  loaded: boolean;
  error: string | null;
  /** 开着的卡（服务端排好的顺序：摊开的在前）。 */
  open: AskView[];
  deferred: AskView[];
  work: ReadonlyMap<string, AskWork>;
}

export const EMPTY_ASKS: AsksData = { loaded: false, error: null, open: [], deferred: [], work: new Map() };

export interface AnswerInput {
  outboundGrant?: OutboundGrantInput;
  optionId?: string;
  text?: string;
}

function place(data: AsksData, ask: AskView): AsksData {
  const open = data.open.filter((item) => item.id !== ask.id);
  const deferred = data.deferred.filter((item) => item.id !== ask.id);
  if (ask.status !== 'open') {
    return { ...data, open, deferred };
  }
  if (ask.deferredAt !== null) {
    return { ...data, open, deferred: [...deferred, ask] };
  }
  const index = data.open.findIndex((item) => item.id === ask.id);
  const next = [...open];
  next.splice(index < 0 ? next.length : index, 0, ask);
  return { ...data, open: next, deferred };
}

function withWork(data: AsksData, id: string, work: AskWork | null): AsksData {
  const next = new Map(data.work);
  if (work === null) {
    next.delete(id);
  } else {
    next.set(id, work);
  }
  return { ...data, work: next };
}

export class AsksStore {
  readonly store = new Store<AsksData>(EMPTY_ASKS);
  private readonly api: PlasticineApi;
  private readonly hub: EventsHub;
  private stopListening: (() => void) | null = null;
  private readonly submissions = new Map<string, string>();

  constructor(api: PlasticineApi, hub: EventsHub) {
    this.api = api;
    this.hub = hub;
  }

  start(): void {
    if (this.stopListening !== null) {
      return;
    }
    this.stopListening = this.hub.on((event) => {
      if (event.type === 'resync') {
        void this.reload();
      } else if (event.type === 'ask.created' || event.type === 'ask.answered' || event.type === 'ask.updated') {
        this.store.set((data) => place(data, event.ask));
      }
    });
    void this.reload();
  }

  stop(): void {
    this.stopListening?.();
    this.stopListening = null;
  }

  async reload(): Promise<void> {
    try {
      const list = await this.api.asks.list();
      const open = [list.current, ...list.queue].filter((ask): ask is AskView => ask !== null);
      this.store.set((data) => ({ ...data, loaded: true, error: null, open, deferred: list.deferred ?? [] }));
    } catch (cause) {
      this.store.set((data) => ({ ...data, loaded: true, error: errorText(cause) }));
    }
  }

  answer(ask: AskView, input: AnswerInput): Promise<void> {
    return this.run(ask, 'answer', JSON.stringify(input), (requestId) =>
      this.api.asks.answer(ask.id, { requestId, ...input })
      .then((response) => response.ask));
  }

  defer(ask: AskView): Promise<void> {
    return this.run(ask, 'defer', '', (requestId) => this.api.asks.defer(ask.id, { requestId })
      .then((response) => response.ask));
  }

  private async run(ask: AskView, what: AskWork['what'], content: string,
    send: (requestId: string) => Promise<AskView>)
    : Promise<void> {
    const previous = this.store.get().work.get(ask.id);
    // 上一次同样的操作没拿到回执：用同一个标识再发，服务端认得出，不会做两次。
    if (previous?.busy === true) { return; }
    const same = previous?.what === what && this.submissions.get(ask.id) === content;
    const requestId = same ? previous.requestId : createRequestId();
    this.submissions.set(ask.id, content);
    this.store.set((data) => withWork(data, ask.id, { requestId, what, busy: true, error: null }));
    try {
      const next = await send(requestId);
      this.submissions.delete(ask.id);
      this.store.set((data) => withWork(place(data, next), ask.id, null));
    } catch (cause) {
      if (!isUncertain(cause)) { this.submissions.delete(ask.id); }
      const error = isUncertain(cause) ? '没确定送到了没有：再点一次同样的，不会重复。' : errorText(cause);
      this.store.set((data) => withWork(data, ask.id, { requestId, what, busy: false, error }));
    }
  }
}
