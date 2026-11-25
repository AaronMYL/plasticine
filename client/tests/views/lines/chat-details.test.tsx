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

async function settledAnswer(): Promise<HTMLElement> {
  let found: HTMLElement | null = null;
  await waitFor(() => {
    found = conv().getByText(/和 Cua 是同一次安装/).closest('[data-message-seq]');
    expect(found).not.toBeNull();
  });
  return found as unknown as HTMLElement;
}

describe('Time dividers between messages', () => {
  it('shows date-time divider on new day or >30min gap; omits for adjacent messages', () => {
    const at = (iso: string) => ({ at: iso });
    const breaks = timeBreaks([at('2026-11-06T02:51:00.000Z'), at('2026-11-06T02:55:00.000Z'),
      at('2026-11-06T03:40:00.000Z'), at('2026-11-06T16:10:00.000Z'), at('2026-11-06T16:12:00.000Z')],
    'Asia/Shanghai');
    expect(breaks).toEqual(['11月6日 10:51', null, '11月6日 11:40', '11月7日 00:10', null]);
  });
});

describe('Main thread conversation', () => {
  it('main thread hides tool steps and thinking, showing only human-facing replies', async () => {
    await openThread();
    send('它是什么时候装上的？谁装的？');
    await conv().findByText(/和 Cua 是同一次安装/);
    expect(screen.queryByRole('button', { name: /做了 \d+ 步/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /想了/ })).toBeNull();
  });

  it('hover bar shows only Quote and More; quoting adds chip above input with no Reply or reactions', async () => {
    await openThread();
    send('它是什么时候装上的？谁装的？');
    const message = await settledAnswer();
    const row = message.closest('.line-msg') as HTMLElement;
    expect(within(row).queryByRole('button', { name: '回复这条' })).toBeNull();
    expect(within(row).queryByRole('button', { name: '表情' })).toBeNull();
    fireEvent.click(within(row).getByRole('button', { name: '引用这条' }));
    const quotes = await screen.findByLabelText('引用片');
    expect(quotes.textContent).toContain('Plasticine');
    expect(screen.queryByRole('group', { name: '正在回复' })).toBeNull();
  });

  it('hover menu Copy copies full message text to clipboard and shows Copied feedback', async () => {
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

  it('new message while scrolled up shows n new messages pill that jumps to latest', async () => {
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

describe('Side chat', () => {
  it('second-column new button creates a teammate instead of an empty chat', async () => {
    const app = await openThread();
    fireEvent.click(within(screen.getByRole('complementary', { name: 'Plasticine' }))
      .getByRole('button', { name: '添加队友' }));
    expect(screen.getByRole('dialog', { name: '创建队友' })).toBeTruthy();
    expect((await app.api.mates.list()).legacyChats).toEqual([]);
    expect(screen.queryByRole('button', { name: '新旁聊' })).toBeNull();
  });

  it('side chat opened from feed item pins that item (source, title, summary) at top', async () => {
    const app = await renderApp({ hash: '#/plasticine' });
    await screen.findByRole('textbox', { name: '问一句' });
    const opened = await app.api.lines.openSide({ requestId: 'side-1', title: '讨论：睡眠中的记忆重放' });
    app.control.lines.put({ ...opened.line, topic: { kind: 'feed', ref: 'f1', title: '睡眠中的记忆重放第一次在人脑里被直接测到',
      source: 'bioRxiv', at: '2026-11-05T02:00:00.000Z', excerpt: '颅内电极记录 18 名受试者' } });
    window.location.hash = `#/plasticine/side/${opened.line.id}`;
    const topic = await screen.findByRole('article', { name: '对话来源' });
    expect(within(topic).getByText('睡眠中的记忆重放第一次在人脑里被直接测到')).toBeTruthy();
    expect(within(topic).getByText(/bioRxiv/)).toBeTruthy();
    expect(within(topic).getByText('颅内电极记录 18 名受试者')).toBeTruthy();
  });
});
