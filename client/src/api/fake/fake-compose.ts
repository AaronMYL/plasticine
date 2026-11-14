// 预测消息（11-13）的假接口：主线和队友给一句和假数据对得上的话，联系人用种子里写好的那句（原来「预测一句」的字）。
// 有草稿时，只在那句话以草稿开头时补后面的；对不上就不给。分两段送，像真的边生成边给。

import type { ComposeApi } from '../client.ts';
import type { ComposeOutcome, ComposePredictView, ComposeTarget } from '../shared.ts';
import type { FakeContacts } from './fake-contacts.ts';
import type { FakeSession } from './fake-session.ts';

/** 主线假数据最后在聊 CuaDriver：接着问的那句。 */
export const FAKE_LINE_PREDICTION = '那现在还用得着吗？不用的话帮我卸了';

export class FakeCompose implements ComposeApi {
  private readonly session: FakeSession;
  private readonly contacts: FakeContacts;
  private seq = 0;
  /** 报回来的结果，测试看这里。 */
  readonly outcomes: ComposeOutcome[] = [];

  constructor(session: FakeSession, contacts: FakeContacts) {
    this.session = session;
    this.contacts = contacts;
  }

  async predict(target: ComposeTarget, draft: string, onText: (delta: string) => void,
    signal?: AbortSignal): Promise<ComposePredictView> {
    this.session.require();
    const whole = target.kind === 'line' ? FAKE_LINE_PREDICTION : this.contacts.cannedReply(target.id) ?? '';
    const text = whole.startsWith(draft) ? whole.slice(draft.length) : '';
    const half = Math.ceil(text.length / 2);
    for (const part of [text.slice(0, half), text.slice(half)]) {
      signal?.throwIfAborted();
      if (part !== '') onText(part);
      await Promise.resolve();
    }
    if (text === '') return { text };
    this.seq += 1;
    return { text, loopId: `fake-compose-${this.seq}` };
  }

  async outcome(input: ComposeOutcome): Promise<void> {
    this.session.require();
    this.outcomes.push(input);
  }
}
