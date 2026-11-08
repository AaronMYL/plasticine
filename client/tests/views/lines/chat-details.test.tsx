// 《优化清单》第 17 条（11-07 设计稿 Plasticine-Main / Side）：消息之间按时间分隔、主线里不列工具步骤、悬停条
// （表情 / 回复 / 更多）、回复某一条、「n 条新消息」、旁聊（开、切、带信息流那一条）、子代理卡「做了 n 步」。

import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { MAIN_LINE_ID } from '../../../src/api/fake/fake-lines.ts';
import { timeBreaks } from '../../../src/views/lines/time-breaks.ts';
import { renderApp, type AppHarness } from '../../helpers.tsx';

async function openThread(hash = '#/plasticine',
  setup?: Parameters<typeof renderApp>[0] extends infer O ? O extends { setup?: infer S } ? S : never : never)
  : Promise<AppHarness> {
  const app = await renderApp({ hash, ...(setup === undefined ? {} : { setup }) });
  await screen.findByRole('textbox', { name: '问一句' });
  return app;
}

function conv(): ReturnType<typeof within> {
  return within(screen.getByRole('region', { name: '对话' }));
}

function send(text: string): void {
  fireEvent.change(screen.getByRole('textbox', { name: '问一句' }), { target: { value: text } });
  fireEvent.click(screen.getByRole('button', { name: '发送' }));
}

/** 跑完、写进库的那段回答（流式时的字没有 seq）。 */
async function settledAnswer(): Promise<HTMLElement> {
  let found: HTMLElement | null = null;
  await waitFor(() => {
    found = conv().getByText(/和 Cua 是同一次安装/).closest('[data-message-seq]');
    expect(found).not.toBeNull();
  });
  return found as unknown as HTMLElement;
}

describe('消息之间的时间分隔', () => {
  it('换了一天、或隔了半小时以上，出一条「11月7日 10:51」；挨着的不出', () => {
    const at = (iso: string) => ({ at: iso });
    const breaks = timeBreaks([at('2026-11-06T02:51:00.000Z'), at('2026-11-06T02:55:00.000Z'),
      at('2026-11-06T03:40:00.000Z'), at('2026-11-06T16:10:00.000Z'), at('2026-11-06T16:12:00.000Z')],
    'Asia/Shanghai');
    expect(breaks).toEqual(['11月6日 10:51', null, '11月6日 11:40', '11月7日 00:10', null]);
  });
});

describe('主线的对话', () => {
  it('主线里不列工具步骤和思考：只有说给人听的话', async () => {
    await openThread();
    send('它是什么时候装上的？谁装的？');
    await conv().findByText(/和 Cua 是同一次安装/);
    expect(screen.queryByRole('button', { name: /做了 \d+ 步/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /想了/ })).toBeNull();
  });

  it('悬停条：回复这一条，输入框上出「回复 Plasticine：……」，发出后气泡上带着它', async () => {
    const app = await openThread();
    send('它是什么时候装上的？谁装的？');
    const message = await settledAnswer();
    const seq = Number(message.dataset['messageSeq']);
    fireEvent.click(within(message.closest('.line-msg') as HTMLElement).getByRole('button', { name: '回复这条' }));
    const chip = await screen.findByRole('group', { name: '正在回复' });
    expect(chip.textContent).toContain('回复 Plasticine');
    send('那它会自己联网吗');
    await waitFor(async () => {
      const read = await app.api.lines.read('main', {});
      expect(read.messages.find((item) => item.text === '那它会自己联网吗')?.replyTo?.seq).toBe(seq);
    });
    expect(await conv().findByText(/回复 Plasticine：/)).toBeTruthy();
    expect(screen.queryByRole('group', { name: '正在回复' })).toBeNull();
  });

  it('悬停条「⋯ · 复制」复制这一条的全文（不是回复用的第一行摘要），写进剪贴板后换成「已复制」回执', async () => {
    const writes: string[] = [];
    Object.defineProperty(navigator, 'clipboard', { configurable: true,
      value: { writeText: async (text: string) => { writes.push(text); } } });
    const long = '第一行写得比较长，超过回复摘要的四十个字：这一句要一直写下去，直到超过那个长度为止才算数。\n第二行也要在';
    await openThread();
    send(long);
    const row = await waitFor(() => {
      const found = (conv().getByText(/第一行写得比较长/) as HTMLElement).closest<HTMLElement>('.line-msg');
      expect(found).not.toBeNull();
      return found as HTMLElement;
    });
    expect(within(row).queryByRole('button', { name: '复制消息' })).toBeNull();
    expect(within(row).queryByRole('button', { name: '引用这句话' })).toBeNull();
    fireEvent.click(within(row).getByRole('button', { name: '更多' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: '复制' }));
    await waitFor(() => expect(writes).toEqual([long]));
    expect(await within(row).findByRole('button', { name: '已复制' })).toBeTruthy();
    expect(within(row).getByRole('status').textContent).toBe('已复制到剪贴板');
    expect(row.querySelector('.line-hoverbar')?.getAttribute('data-open')).toBe('true');
  });

  it('表情：点了加一个反应、存下来；再点那个反应拿掉', async () => {
    const app = await openThread();
    send('它是什么时候装上的？谁装的？');
    const answer = await settledAnswer();
    const row = answer.closest('.line-msg') as HTMLElement;
    const seq = Number(answer.dataset['messageSeq']);
    fireEvent.click(within(row).getByRole('button', { name: '表情' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: '👍' }));
    const chip = await within(row).findByRole('button', { name: '👍，点了拿掉' });
    await waitFor(async () => expect((await app.api.lines.read('main', {})).messages
      .find((item) => item.seq === seq)?.reactions).toEqual(['👍']));
    fireEvent.click(chip);
    await waitFor(() => expect(within(row).queryByRole('button', { name: '👍，点了拿掉' })).toBeNull());
  });

  it('往上翻着看时来了新消息：出「n 条新消息」，点了回到最新', async () => {
    const app = await openThread();
    const scroller = screen.getByRole('log', { name: '对话记录' });
    Object.defineProperty(scroller, 'scrollHeight', { configurable: true, value: 2000 });
    Object.defineProperty(scroller, 'clientHeight', { configurable: true, value: 500 });
    scroller.scrollTop = 100;
    fireEvent.scroll(scroller);
    await act(async () => {
      app.control.lines.record(MAIN_LINE_ID, { role: 'notice', text: '项目「研究周报」逾期了', thinking: null,
        thinkingMs: null, steps: [], toolCallId: null, tool: null, say: null, ok: null, summary: '逾期',
        stopReason: null, childLineId: null, attachments: [], widgets: [], createdAt: new Date().toISOString() });
    });
    const pill = await screen.findByRole('button', { name: '1 条新消息' });
    fireEvent.click(pill);
    await waitFor(() => expect(screen.queryByRole('button', { name: /条新消息/ })).toBeNull());
  });
});

describe('旁聊', () => {
  it('从第二栏顶上开一条新旁聊：换到旁聊，输入框写「在旁聊里接着说」，发出第一句起标题', async () => {
    await openThread();
    fireEvent.click(within(screen.getByRole('complementary', { name: 'Plasticine' }))
      .getByRole('button', { name: '新旁聊' }));
    const box = await screen.findByPlaceholderText('在旁聊里接着说');
    expect(box).toBeTruthy();
    send('Arc 的竖排标签怎么做');
    expect(await screen.findByRole('heading', { name: 'Arc 的竖排标签怎么做' })).toBeTruthy();
  });

  it('从信息流那一条开的旁聊：顶上是那一条（来源、标题、摘要）', async () => {
    const app = await renderApp({ hash: '#/plasticine' });
    await screen.findByRole('textbox', { name: '问一句' });
    const opened = await app.api.lines.openSide({ requestId: 'side-1', title: '讨论：睡眠中的记忆重放' });
    app.control.lines.put({ ...opened.line, topic: { kind: 'feed', ref: 'f1', title: '睡眠中的记忆重放第一次在人脑里被直接测到',
      source: 'bioRxiv', at: '2026-11-05T02:00:00.000Z', excerpt: '颅内电极记录 18 名受试者' } });
    window.location.hash = `#/plasticine/side/${opened.line.id}`;
    const topic = await screen.findByRole('article', { name: '旁聊围绕的那一条' });
    expect(within(topic).getByText('睡眠中的记忆重放第一次在人脑里被直接测到')).toBeTruthy();
    expect(within(topic).getByText(/bioRxiv/)).toBeTruthy();
    expect(within(topic).getByText('颅内电极记录 18 名受试者')).toBeTruthy();
  });
});
