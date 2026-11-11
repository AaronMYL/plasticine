// 和 Plasticine 的对话读主对话那条线（2026-11-05 Harness 重做）：发一句开一轮、做完收成「做了 n 步」、在跑时发的进排队
// （立即发送 / 撤回）、停止键、出错一行能重试、额度暂停一行、硬线卡在等你的那一轮下面摊开。

import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { MAIN_LINE_ID } from '../../../src/api/fake/fake-lines.ts';
import { renderApp, type AppHarness } from '../../helpers.tsx';

async function openThread(setup?: (app: Parameters<NonNullable<Parameters<typeof renderApp>[0]>['setup'] & object>[0])
  => void): Promise<AppHarness> {
  const app = await renderApp({ hash: '#/messages/plasticine', ...(setup === undefined ? {} : { setup }) });
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

describe('和 Plasticine 的对话', () => {
  it('发一句：气泡出来、跑完一轮，回答是普通文字；主线不列步骤和思考（第 17 条：工具日志不进对话）', async () => {
    await openThread();
    send('它是什么时候装上的？谁装的？');
    expect(await screen.findByText('它是什么时候装上的？谁装的？')).toBeTruthy();
    await conv().findByText(/和 Cua 是同一次安装/);
    expect(screen.queryByRole('button', { name: /做了 \d+ 步/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /想了/ })).toBeNull();
  });

  it('线在跑时：只有一行实时状态，旁边是停止键；再发的进排队，能立即发送、能撤回', async () => {
    const app = await openThread(({ control }) => {
      control.lines.change(MAIN_LINE_ID, { status: 'running', activity: '在 Mac 上读签名…',
        activeSince: new Date().toISOString() });
    });
    expect(await conv().findByText('在 Mac 上读签名…')).toBeTruthy();
    expect(await screen.findByRole('button', { name: '暂停' })).toBeTruthy();
    send('再看看开机自启');
    const queue = await screen.findByRole('list', { name: '排队的消息' });
    expect(within(queue).getByText('再看看开机自启')).toBeTruthy();
    send('第二条');
    await waitFor(() => expect(within(queue).getAllByRole('listitem')).toHaveLength(2));
    fireEvent.click(within(queue).getAllByRole('button', { name: '撤回' })[1]!);
    await waitFor(() => expect(screen.queryByText('第二条')).toBeNull());
    fireEvent.click(within(screen.getByRole('list', { name: '排队的消息' })).getByRole('button', { name: '立即发送' }));
    await waitFor(() => expect(screen.queryByRole('list', { name: '排队的消息' })).toBeNull());
    expect((await app.api.lines.read('main', {})).messages.some((message) => message.text === '再看看开机自启'))
      .toBe(true);
  });

  it('已经插进这一轮的那条（服务端记着 inserted）：刷新后照旧写「下一步插进去」，不再给立即发送', async () => {
    await openThread(({ control }) => {
      control.lines.change(MAIN_LINE_ID, { status: 'running', activity: '在想…', activeSince: new Date().toISOString() });
      control.lines.seedQueued(MAIN_LINE_ID, '顺便看看开机自启', 'inserted');
    });
    const queue = await screen.findByRole('list', { name: '排队的消息' });
    expect(within(queue).getByRole('status').textContent).toBe('下一步插进去');
    expect(within(queue).queryByRole('button', { name: '立即发送' })).toBeNull();
  });

  it('点停止：这一轮停下，停止键收起，记一笔「停下了」', async () => {
    await openThread(({ control }) => {
      control.lines.change(MAIN_LINE_ID, { status: 'running', activity: '在想…', activeSince: new Date().toISOString() });
    });
    fireEvent.click(await screen.findByRole('button', { name: '暂停' }));
    await waitFor(() => expect(screen.queryByRole('button', { name: '暂停' })).toBeNull());
    expect(await conv().findByRole('button', { name: '继续' })).toBeTruthy();
    expect(await conv().findByText('停下了')).toBeTruthy();
  });

  it('连不上模型：一行红字 + 重试；额度用完：几点接着做', async () => {
    const app = await openThread(({ control }) => {
      control.lines.change(MAIN_LINE_ID, { status: 'failed', failure: '连不上模型，已重试 3 次' });
    });
    expect((await conv().findByRole('alert')).textContent).toContain('连不上模型，已重试 3 次');
    act(() => {
      app.control.lines.change(MAIN_LINE_ID, { status: 'paused', pauseReason: 'quota', failure: '额度用完',
        pausedUntil: '2026-10-27T13:00:00.000Z' });
    });
    expect(await conv().findByText(/额度用完，\d\d:00 后接着做/)).toBeTruthy();
  });

  it('系统通知：主线上一行铃 + 一句话，不是他的气泡，也不是 Plasticine 的回答', async () => {
    await openThread(({ control }) => {
      control.lines.notice('项目「资料交接」过了截止日（2026-10-30）还没完成：看是改截止还是接着推进。', '有项目过了截止日');
    });
    const notice = await conv().findByRole('note', { name: '系统通知' });
    expect(notice.textContent).toContain('资料交接');
    expect(notice.closest('.user-message')).toBeNull();
  });

  it('后台线卡：跑完了但没做成是叉加一句原因（红字），做成的照旧打勾', async () => {
    await openThread(({ control }) => {
      control.lines.put(control.lines.blank('unmet', 'background', '设置每日续火花', { parentLineId: MAIN_LINE_ID,
        outcome: 'done', unmet: '当时还不能新建定时任务' }));
      control.lines.put(control.lines.blank('ok', 'background', '刷新信息流', { parentLineId: MAIN_LINE_ID,
        outcome: 'done' }));
    });
    const unmet = await screen.findByRole('article', { name: '线：设置每日续火花' });
    expect(within(unmet).getByRole('img', { name: '没做成' })).toBeTruthy();
    expect(within(unmet).getByText('没做成：当时还不能新建定时任务').getAttribute('data-status')).toBe('unmet');
    const ok = screen.getByRole('article', { name: '线：刷新信息流' });
    expect(within(ok).getByRole('img', { name: '已完成' })).toBeTruthy();
  });

  it('硬线卡：在等你的那一轮下面摊开，后果常显；点「发出」作答', async () => {
    const app = await openThread(({ control }) => {
      control.lines.change(MAIN_LINE_ID, { status: 'waiting', activeSince: '2026-10-27T01:00:00.000Z' });
      control.asks.raise({ id: 'ask-hard', kind: 'approve', basis: 'hard_line', lineId: MAIN_LINE_ID,
        question: '要把这封回复发给 Bolt 吗？',
        detail: '发出后对方会收到，撤不回\n硬线：……\n「mail_send」的参数：{"to":"Bolt 账单组","body":"你好"}',
        options: [{ id: 'allow', label: '发出', recommended: true, description: null },
          { id: 'deny', label: '先不', recommended: false, description: null }] });
    });
    const card = await screen.findByRole('region', { name: /要把这封回复发给 Bolt 吗/ });
    expect(within(card).getByText('发出后对方会收到，撤不回')).toBeTruthy();
    expect(within(card).getByText('Bolt 账单组')).toBeTruthy();
    fireEvent.click(within(card).getByRole('button', { name: '发出（推荐）' }));
    await waitFor(async () => expect((await app.api.asks.get('ask-hard')).status).toBe('answered'));
  });

  it('后台任务等你定：要你定卡就地画在对话里的任务卡里，能直接答（11-11）', async () => {
    const app = await openThread(({ control }) => {
      control.lines.put(control.lines.blank('clean', 'background', '修复删除记忆后名称残留',
        { parentLineId: MAIN_LINE_ID, status: 'waiting' }));
      control.asks.raise({ id: 'ask-clean', kind: 'approve', lineId: 'clean', question: '要把两份空记忆的名称也清掉吗？',
        options: [{ id: 'allow', label: '彻底清掉', recommended: true, description: null },
          { id: 'deny', label: '暂不清除', recommended: false, description: null }] });
    });
    const task = await screen.findByRole('article', { name: '线：修复删除记忆后名称残留' });
    const card = await within(task).findByRole('region', { name: /要把两份空记忆的名称也清掉吗/ });
    fireEvent.click(within(card).getByRole('button', { name: '彻底清掉（推荐）' }));
    await waitFor(async () => expect((await app.api.asks.get('ask-clean')).status).toBe('answered'));
  });

  it('笔记引用连版本写进消息：读回来是引用片、写明第几版；引用合计超过上限先说，不发', async () => {
    const app = await openThread();
    act(() => app.state.conversationUi.addQuote({ id: 'q-note', kind: 'note', sourceId: 'note-1', label: '《读书摘记》',
      text: '第一段\n\n最后一句',
      noteReference: { noteId: 'note-1', version: 3, scope: 'full' } }));
    send('按这一版回答');
    await waitFor(async () => {
      const user = (await app.api.lines.read('main', {})).messages.find((message) => message.role === 'user');
      expect(user?.text).toContain('〔笔记引用〕');
    });
    const bubbles = await conv().findAllByText('按这一版回答');
    expect(bubbles.some((bubble: HTMLElement) => bubble.closest('.msg-user')?.textContent?.includes('第 3 版')))
      .toBe(true);
    act(() => app.state.conversationUi.addQuote({ id: 'q-long', kind: 'message', sourceId: 'm-1', label: '长材料',
      text: '字'.repeat(120_001) }));
    expect(await screen.findByText(/一次引用合计最多 120,000 字/)).toBeTruthy();
    expect(screen.getByRole('button', { name: '发送' }).hasAttribute('disabled')).toBe(true);
  });
});


describe('样刊附的「开启定时」卡（第 7 批第 14 条）', () => {
  it('不挂在线上、主线空闲也摊在最下面：每周五 08:00 出一期 + 订阅名（站内链到那一期）；点「开启定时」作答收起', async () => {
    const app = await openThread(({ control }) => {
      control.asks.raise({ id: 'ask-sample', kind: 'decide', question: '每周五 08:00 出一期', lineId: null,
        detail: '认知科学与意识研究周报', basis: 'inferred',
        options: [{ id: 'start', label: '开启定时', recommended: true, description: null },
          { id: 'revise', label: '再改改', recommended: false, description: null }],
        subscriptionCard: { subscriptionId: 'sub-1', title: '认知科学与意识研究周报', when: '每周五 08:00 出一期',
          spaceId: 'space-1', issueNumber: 1 } });
    });
    const card = await screen.findByRole('region', { name: '每周五 08:00 出一期 · 认知科学与意识研究周报' });
    expect(within(card).getByRole('link', { name: '看认知科学与意识研究周报第 1 期' }).getAttribute('href'))
      .toBe('#/books/space/space-1');
    expect(within(card).getAllByRole('button').map((button) => button.textContent)).toEqual(['开启定时', '再改改']);
    fireEvent.click(within(card).getByRole('button', { name: '开启定时' }));
    await waitFor(async () => expect((await app.api.asks.get('ask-sample')).answer?.optionId).toBe('start'));
    await waitFor(() => expect(screen.queryByRole('region', { name: /每周五 08:00 出一期/ })).toBeNull());
  });
});
