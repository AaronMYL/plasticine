// 通知按类型开关（第13批，11-14 Aaron 定）：设置 · 通用 · 通知下面七类各一个开关，所有设备一起；关掉的那一类桌面客户端
// 也不自己弹（卡、来信、主线的提醒）；「等你的事」关着时写一句后果；存不上退回原样。

import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { LineMessageView } from '../../../src/api/shared.ts';
import { createFakeApi } from '../../../src/api/fake/index.ts';
import type { FakePush } from '../../../src/api/fake/fake-push.ts';
import { FakePushDevice } from '../../../src/api/fake/fake-push-device.ts';
import { PushSwitch } from '../../../src/views/settings/push-switch.ts';
import { NOW, renderApp } from '../../helpers.tsx';

afterEach(() => {
  delete (window as { plasticineDesktop?: unknown }).plasticineDesktop;
  vi.restoreAllMocks();
});

function mainMessage(seq: number, fields: Partial<LineMessageView>): LineMessageView {
  return { lineId: 'line-main', seq, role: 'assistant', origin: null, text: '', thinking: null, thinkingMs: null,
    steps: [], toolCallId: null, tool: null, say: null, ok: null, summary: null, stopReason: null, childLineId: null,
    attachments: [], widgets: [], createdAt: '2026-11-14T10:00:00.000Z', ...fields };
}

describe('通知按类型开关', () => {
  it('设置里七类各一个开关，默认开着；关掉一类存到服务器上，「等你的事」关着时写后果', async () => {
    const app = await renderApp({ hash: '#/settings/general' });
    const list = await screen.findByRole('list', { name: '通知哪些事' });
    const switches = within(list).getAllByRole('switch');
    expect(switches.map((item) => item.getAttribute('aria-label'))).toEqual(['等你的事', '联系人消息', '群组消息',
      '主线回复', '队友回复', '来信', '提醒和结果']);
    expect(switches.every((item) => (item as HTMLInputElement).checked)).toBe(true);
    fireEvent.click(within(list).getByRole('switch', { name: '群组消息' }));
    await waitFor(() => expect((app.api.push as FakePush).storedKinds.group).toBe(false));
    expect(screen.queryByRole('note')).toBeNull();
    fireEvent.click(within(list).getByRole('switch', { name: '等你的事' }));
    expect((await screen.findByRole('note')).textContent).toBe('要你同意、回答的事不会弹出来，记得去首页「等你」看。');
    await waitFor(() => expect((app.api.push as FakePush).storedKinds.ask).toBe(false));
  });

  it('存不上：开关退回原样，写原因', async () => {
    const app = await renderApp({ hash: '#/settings/general' });
    vi.spyOn(app.api.push, 'saveKinds').mockRejectedValueOnce(new Error('连接中断'));
    const list = await screen.findByRole('list', { name: '通知哪些事' });
    fireEvent.click(within(list).getByRole('switch', { name: '来信' }));
    expect((await screen.findByText(/没存上/)).textContent).toContain('连接中断');
    expect((within(list).getByRole('switch', { name: '来信' }) as HTMLInputElement).checked).toBe(true);
  });

  it('桌面客户端：关掉的那一类自己也不弹（卡、来信、主线提醒）；别处改了跟着变', async () => {
    const notify = vi.fn();
    (window as { plasticineDesktop?: unknown }).plasticineDesktop = { notify };
    const fake = createFakeApi({ seed: false, streamStepMs: 0, now: () => NOW });
    const toggle = new PushSwitch(fake.api, new FakePushDevice({ answer: 'granted' }));
    await act(async () => { await toggle.loadKinds(); });
    toggle.onEvent({ type: 'notify.kinds', kinds: { ask: true, contact: true, group: true, main: true, mate: true,
      letter: false, notice: true } });
    const line = (message: LineMessageView) => ({ type: 'line' as const,
      event: { type: 'line_message' as const, message } });
    toggle.onEvent(line(mainMessage(1, { role: 'letter' })), 'line-main');
    expect(notify).not.toHaveBeenCalled();
    toggle.onEvent(line(mainMessage(2, { role: 'notice', summary: '服务器磁盘空间不足' })), 'line-main');
    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify.mock.calls[0]?.[1]).toBe('服务器磁盘空间不足');
  });
});
