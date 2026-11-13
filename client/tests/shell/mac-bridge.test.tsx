import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { MAIN_LINE_ID } from '../../src/api/fake/fake-lines.ts';
import { inDesktopApp } from '../../src/shell/host.ts';
import { renderApp } from '../helpers.tsx';

afterEach(() => {
  delete window.plasticineDesktop;
  vi.restoreAllMocks();
});

it('桌面客户端标识支持注入对象和 User-Agent，普通浏览器不会误认（界面只经 host.ts 问壳）', () => {
  expect(inDesktopApp()).toBe(false);
  vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue('Mozilla/5.0 PlasticineMac/1.2.3');
  expect(inDesktopApp()).toBe(true);
});

it('立刻打断走 Mac notify，普通卡不通知，不申请浏览器权限，设置说明由 App 发送', async () => {
  const notify = vi.fn();
  window.plasticineDesktop = { version: '1.0', notify };
  const app = await renderApp();
  act(() => {
    app.control.asks.raise({ id: 'mac-urgent', kind: 'act', channel: 'interrupt', question: '请现在处理' });
    app.control.asks.raise({ id: 'mac-normal', kind: 'decide', channel: 'popup', question: '稍后看看' });
  });
  await waitFor(() => expect(notify).toHaveBeenCalledTimes(1));
  expect(notify).toHaveBeenCalledWith('等你动手', '有一件事要你现在处理，点开看。', '#/plasticine');
  fireEvent.click(within(screen.getByRole('navigation', { name: '栏目' })).getByRole('button', { name: /^设置/ }));
  const tip = await within(await screen.findByRole('dialog', { name: '设置' }))
    .findByRole('button', { name: '通知的说明' });
  await waitFor(() => expect(tip.getAttribute('aria-description')).toContain('这台电脑的客户端能收到'));
  expect(app.pushDevice.prompts).toBe(0);
  expect(app.pushDevice.subscribedWith).toBeNull();
});

it('暂缓独立卡的延迟出卡事件不触发 Mac 通知，新的卡仍照常提醒', async () => {
  const notify = vi.fn();
  window.plasticineDesktop = { version: '1.0', notify };
  const app = await renderApp({ setup(fake) {
    fake.control.asks.raise({ id: 'deferred-native', kind: 'act', channel: 'interrupt', question: '暂缓原题' });
  } });
  await act(async () => {
    const { ask } = await app.api.asks.defer('deferred-native', { requestId: 'defer-native' });
    app.control.bus.emit({ type: 'ask.created', ask, current: false });
  });
  expect(notify).not.toHaveBeenCalled();
  act(() => {
    app.control.asks.raise({ id: 'native-active', kind: 'act', channel: 'interrupt', question: '仍需确认' });
  });
  expect(notify).toHaveBeenCalledTimes(1);
});

it('__plasticineAttachFiles 按 attachments.add 上传，保留草稿并展开聚焦输入框', async () => {
  window.plasticineDesktop = { version: '1', notify: vi.fn() };
  const app = await renderApp({ hash: '#/notes', width: 1440 });
  act(() => { app.state.shellPrefs.setChatOpen(false); app.state.conversationUi.setDraft('一起读'); });
  expect(screen.queryByLabelText('问一句')).toBeNull();
  await act(async () => {
    await window.__plasticineAttachFiles?.([{ name: '资料.txt', type: 'text/plain',
      base64: btoa('hello from Mac') }]);
  });
  await waitFor(() => expect(app.state.attachments.ready()).toBe(true));
  expect(app.state.attachments.active()).toHaveLength(1);
  expect(app.state.attachments.active()[0]?.remote?.name).toBe('资料.txt');
  const composer = screen.getByLabelText('问一句');
  expect(composer).toBe(document.activeElement);
  expect(composer).toHaveProperty('value', '一起读');
  app.view.unmount();
  expect(window.__plasticineAttachFiles).toBeUndefined();
});

it('聚焦快捷入口展开对话；新建笔记快捷入口打开新笔记，连续调用不重复创建进行中的一篇', async () => {
  window.plasticineDesktop = { version: '1', notify: vi.fn() };
  const app = await renderApp({ hash: '#/today', width: 1440 });
  act(() => app.state.shellPrefs.setChatOpen(false));
  act(() => window.__plasticineFocusComposer?.());
  await waitFor(() => expect(screen.getByLabelText('问一句')).toBe(document.activeElement));
  const create = vi.spyOn(app.api.notes, 'create');
  await act(async () => {
    await Promise.all([window.__plasticineNewNote?.(), window.__plasticineNewNote?.()]);
  });
  expect(create).toHaveBeenCalledTimes(1);
  await waitFor(() => expect(window.location.hash).toMatch(/^#\/notes\/[^/]+$/));
});

it('无效 base64 就地显示附件错误，之后仍能附加文件', async () => {
  const app = await renderApp({ hash: '#/conversation' });
  await act(async () => window.__plasticineAttachFiles?.([{ name: '坏.txt', type: 'text/plain', base64: '%%%' }]));
  expect(app.state.attachments.active()).toHaveLength(0);
  expect(await screen.findByText(/Mac 文件没能加入/)).toBeDefined();
});

it('主线上的系统通知和贴回主线的后台线结果也弹 Mac 通知（《优化清单》第 12 条）：只一句话，同一条不弹两次', async () => {
  const notify = vi.fn();
  window.plasticineDesktop = { version: '1.0', notify };
  const app = await renderApp();
  act(() => {
    app.control.lines.notice('项目「资料交接」过了截止日还没完成。', '有项目过了截止日');
  });
  await waitFor(() => expect(notify).toHaveBeenCalledWith('Plasticine', '有项目过了截止日', '#/plasticine'));
  act(() => {
    app.control.lines.record(MAIN_LINE_ID, { role: 'lineReport', text: '私密的结果', thinking: null, thinkingMs: null,
      steps: [], toolCallId: null, tool: null, say: null, ok: false, summary: null, stopReason: 'unmet',
      childLineId: 'child-1', attachments: [], widgets: [], createdAt: new Date().toISOString() });
    app.control.lines.record('child-1', { role: 'assistant', text: '子线自己的回答', thinking: null, thinkingMs: null,
      steps: [], toolCallId: null, tool: null, say: null, ok: null, summary: null, stopReason: 'stop',
      childLineId: null, attachments: [], widgets: [], createdAt: new Date().toISOString() });
  });
  await waitFor(() => expect(notify).toHaveBeenCalledTimes(2));
  expect(notify).toHaveBeenLastCalledWith('Plasticine', '后台的一件事没做成', '#/plasticine');
  expect(JSON.stringify(notify.mock.calls)).not.toContain('私密');
});

it('后台线做成的结果只贴在主线上、不弹 Mac 通知；做到一半停了的照旧弹（11-07 他定「只在没做成时弹」）', async () => {
  const notify = vi.fn();
  window.plasticineDesktop = { version: '1.0', notify };
  const app = await renderApp();
  const report = (childLineId: string, stopReason: string) => ({ role: 'lineReport' as const, text: '结果',
    thinking: null, thinkingMs: null, steps: [], toolCallId: null, tool: null, say: null, ok: null, summary: null,
    stopReason, childLineId, attachments: [], widgets: [], createdAt: new Date().toISOString() });
  act(() => {
    app.control.lines.record(MAIN_LINE_ID, report('child-done', 'done'));
    app.control.lines.record(MAIN_LINE_ID, report('child-failed', 'failed'));
  });
  await waitFor(() => expect(notify).toHaveBeenCalledTimes(1));
  expect(notify).toHaveBeenCalledWith('Plasticine', '后台的一件事没做完', '#/plasticine');
});
