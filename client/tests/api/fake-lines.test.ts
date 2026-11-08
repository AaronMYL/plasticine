// 假的线照新内核的语义：空闲时发 = 开一轮（跑完回答写进库、线回到空闲），在跑时发 = 进排队（这一轮结束按顺序发出），
// 撤回、叫停、同一个 requestId 重发不出两条；每一步推 line_tool，回答推 line_text。

import { describe, expect, it } from 'vitest';
import { createFakeApi } from '../../src/api/fake/index.ts';
import { MAIN_LINE_ID } from '../../src/api/fake/fake-lines.ts';
import { EventsHub } from '../../src/api/events-hub.ts';
import { LINE_MESSAGE_MAX_CHARS, type SendLineMessageRequest } from '../../src/api/shared.ts';
import type { LiveEvent, Quote } from '../../src/api/types.ts';
import { LinesStore } from '../../src/views/lines/line-store.ts';

function setup() {
  const fake = createFakeApi({ seed: false, streamStepMs: 0, now: () => new Date('2026-11-05T12:00:00Z') });
  fake.control.session.signInForDevelopment('测试机');
  const events: LiveEvent[] = [];
  fake.api.events.subscribe({ onEvent: (event) => events.push(event), onStatus: () => undefined });
  return { ...fake, events };
}

const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

describe('假的线', () => {
  it('空闲时发一句开一轮：推思考、步骤、文字，回答写进库，线回到空闲', async () => {
    const { api, events } = setup();
    const sent = await api.lines.send('main', { requestId: 'r-1', text: '它是谁装的？' });
    expect(sent.outcome).toBe('started');
    await flush();
    const page = await api.lines.read('main', {});
    expect(page.line.status).toBe('idle');
    expect(page.messages.at(-1)?.text).toContain('Cua AI, Inc.');
    const types = new Set(events.flatMap((event) => (event.type === 'line' ? [event.event.type] : [])));
    expect([...types].sort()).toEqual(['line_changed', 'line_message', 'line_text', 'line_thinking', 'line_tool']);
    const again = await api.lines.send('main', { requestId: 'r-1', text: '它是谁装的？' });
    expect(again.message?.seq).toBe(sent.message?.seq);
  });

  it('在跑时发的进排队；撤回的不再发；暂停后须明确继续才处理剩下的输入', async () => {
    const { api, control } = setup();
    control.lines.change(MAIN_LINE_ID, { status: 'running' });
    const first = await api.lines.send('main', { requestId: 'q-1', text: '第一条' });
    const second = await api.lines.send('main', { requestId: 'q-2', text: '第二条' });
    expect(first.outcome).toBe('queued');
    expect((await api.lines.read('main', {})).queue.map((item) => item.text)).toEqual(['第一条', '第二条']);
    await api.lines.withdraw('main', second.queued!.id, { requestId: 'w-1' });
    expect((await api.lines.read('main', {})).line.queued).toBe(1);
    const stopped = await api.lines.stop('main', { requestId: 's-1' });
    expect(stopped.line.status).toBe('paused');
    expect(stopped.line.pauseReason).toBe('user');
    await api.lines.retry('main', { requestId: 'n-1' });
    await flush();
    const page = await api.lines.read('main', {});
    expect(page.queue).toEqual([]);
    expect(page.messages.some((message) => message.role === 'user' && message.text === '第一条')).toBe(true);
    expect(page.messages.some((message) => message.text === '第二条')).toBe(false);
  });

  it('用户暂停时补充只排队，保留旧结果但不把它标成新的完成', async () => {
    const { api, control } = setup();
    control.lines.change(MAIN_LINE_ID, { status: 'paused', pauseReason: 'user', outcome: 'stopped',
      lastAnswer: '上一次的结果' });
    const sent = await api.lines.send('main', { requestId: 'paused-input', text: '再核对下来源' });
    expect(sent.outcome).toBe('queued');
    await flush();
    const page = await api.lines.read('main', {});
    expect(page.line.status).toBe('paused');
    expect(page.line.pauseReason).toBe('user');
    expect(page.line.outcome).not.toBe('done');
    expect(page.line.lastAnswer).toBe('上一次的结果');
    expect(page.queue.map((item) => item.text)).toEqual(['再核对下来源']);
  });

  it('详情里的本人原话是输入本身，不把引用全文拼进去', async () => {
    const { api } = setup();
    await api.lines.send('main', { requestId: 'source', text: '这页的结论是什么？',
      quotes: [{ kind: 'text', label: '当前页', text: '第三方的材料' }] });
    await flush();
    const details = await api.lines.details('main', {});
    expect(details.request?.source?.text).toBe('这页的结论是什么？');
    expect(details.results[0]?.text).toBe((await api.lines.read('main', {})).messages.at(-1)?.text);
    expect(details.line.outcome).toBe('done');
  });

  it('带引用发：整页长的引用结构化交给服务端，不占这句话的 2 万字，存下的正文里引用在前', async () => {
    const { api } = setup();
    const long = '页'.repeat(LINE_MESSAGE_MAX_CHARS + 500);
    const sent = await api.lines.send('main', { requestId: 'r-q', text: '这页讲了什么？',
      quotes: [{ kind: 'text', label: '当前页', text: long }] });
    expect(sent.message?.text.startsWith('> 〔引用〕当前页\n> 页')).toBe(true);
    expect(sent.message?.text.endsWith('\n\n这页讲了什么？')).toBe(true);
  });

  it('LinesStore 发带引用的一句：请求里话和引用分开，待发那条按存下的格式先显示', async () => {
    const { api } = setup();
    const store = new LinesStore(api, new EventsHub(api.events));
    const sends: SendLineMessageRequest[] = [];
    const send = api.lines.send.bind(api.lines);
    api.lines.send = (lineId, body) => {
      sends.push(body);
      return send(lineId, body);
    };
    const quote: Quote = { id: 'q', kind: 'message', sourceId: 'm1', label: '那句话', text: '原话' };
    const sending = store.send('main', '为什么？', [], [quote]);
    expect(store.thread('main').get().pending[0]?.text).toBe('> 〔引用〕那句话\n> 原话\n\n为什么？');
    await sending;
    expect(sends[0]?.text).toBe('为什么？');
    expect(sends[0]?.quotes).toEqual([{ kind: 'text', label: '那句话', text: '原话' }]);
  });
});
