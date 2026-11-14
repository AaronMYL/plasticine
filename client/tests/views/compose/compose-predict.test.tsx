// 预测消息（11-13 Aaron 定，设计稿「预测消息 · 设计稿」）：对话和消息输入框里的浅色字。
import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { seedContacts } from '../../../src/api/fake/contacts-seed.ts';
import { FAKE_LINE_PREDICTION } from '../../../src/api/fake/fake-compose.ts';
import type { FakeApi } from '../../../src/api/fake/index.ts';
import { PAUSE_MS } from '../../../src/views/compose/use-compose-predict.ts';
import { NOW, renderApp, type AppHarness } from '../../helpers.tsx';

const WAIT = { timeout: PAUSE_MS + 2000 };

async function mainLine(): Promise<{ app: AppHarness; box: HTMLTextAreaElement }> {
  const app = await renderApp({ hash: '#/messages/plasticine' });
  const box = await screen.findByRole<HTMLTextAreaElement>('textbox', { name: '问一句' });
  return { app, box };
}

function ghost(): string | null {
  return document.querySelector('.compose-ghost')?.textContent ?? null;
}

function type(box: HTMLTextAreaElement, value: string): void {
  fireEvent.change(box, { target: { value } });
  box.setSelectionRange(value.length, value.length);
}

describe('输入建议', () => {
  it('空着、聚焦：停手后给一整句；Tab 采纳成正常的字，光标在末尾，不发送，报收下', async () => {
    const { app, box } = await mainLine();
    const outcome = vi.spyOn(app.api.compose, 'outcome');
    const sent = vi.spyOn(app.api.lines, 'send');
    act(() => box.focus());
    await waitFor(() => expect(ghost()).toBe(FAKE_LINE_PREDICTION), WAIT);
    expect(box.placeholder).toBe('');
    fireEvent.keyDown(box, { key: 'Tab' });
    expect(box.value).toBe(FAKE_LINE_PREDICTION);
    expect(ghost()).toBeNull();
    await waitFor(() => expect(outcome).toHaveBeenCalledWith({ loopId: expect.stringMatching(/^fake-compose-/),
      outcome: 'kept' }));
    expect(sent).not.toHaveBeenCalled();
  });

  it('打了字只补后面的；接着打对得上就吃掉，对不上就撤下', async () => {
    const { box } = await mainLine();
    act(() => box.focus());
    type(box, '那现在还');
    await waitFor(() => expect(ghost()).toBe(FAKE_LINE_PREDICTION.slice('那现在还'.length)), WAIT);
    type(box, '那现在还用');
    expect(ghost()).toBe(FAKE_LINE_PREDICTION.slice('那现在还用'.length));
    type(box, '那现在还用不');
    expect(ghost()).toBeNull();
  });

  it('Esc 收起这一条、报没要；没建议时 Tab 照原样（不拦）', async () => {
    const { app, box } = await mainLine();
    const outcome = vi.spyOn(app.api.compose, 'outcome');
    act(() => box.focus());
    await waitFor(() => expect(ghost()).not.toBeNull(), WAIT);
    fireEvent.keyDown(box, { key: 'Escape' });
    expect(ghost()).toBeNull();
    await waitFor(() => expect(outcome).toHaveBeenCalledWith(expect.objectContaining({ outcome: 'rejected' })));
    expect(fireEvent.keyDown(box, { key: 'Tab' })).toBe(true);
  });

  it('输入法组词期间不猜；组完再猜', async () => {
    const { app, box } = await mainLine();
    const predict = vi.spyOn(app.api.compose, 'predict');
    act(() => box.focus());
    fireEvent.compositionStart(box);
    type(box, '那');
    await new Promise((resolve) => setTimeout(resolve, PAUSE_MS + 200));
    const during = predict.mock.calls.filter(([, draft]) => draft === '那').length;
    expect(during).toBe(0);
    expect(ghost()).toBeNull();
    fireEvent.compositionEnd(box);
    await waitFor(() => expect(ghost()).toBe(FAKE_LINE_PREDICTION.slice(1)), WAIT);
  });

  it('设置 · AI 关掉输入建议：一句都不猜', async () => {
    const { app, box } = await mainLine();
    act(() => app.state.shellPrefs.setComposePredict(false));
    const predict = vi.spyOn(app.api.compose, 'predict');
    act(() => box.focus());
    await new Promise((resolve) => setTimeout(resolve, PAUSE_MS + 200));
    expect(predict).not.toHaveBeenCalled();
    expect(ghost()).toBeNull();
  });

  it('消息里和朋友聊：一样给浅色字，点一下采纳', async () => {
    const seed = ({ control: { contacts, network, visibility, m5b } }: FakeApi): void => {
      seedContacts({ contacts, inbox: m5b.inbox, network, visibility }, NOW);
    };
    await renderApp({ hash: '#/messages/c_linyi', width: 1440, setup: seed });
    const box = await screen.findByRole<HTMLTextAreaElement>('textbox', { name: '发给林一' });
    act(() => box.focus());
    await waitFor(() => expect(ghost()).toBe('好，周四晚上我看第一版'), WAIT);
    fireEvent.click(document.querySelector('.compose-ghost')!);
    expect(box.value).toBe('好，周四晚上我看第一版');
  });
});
