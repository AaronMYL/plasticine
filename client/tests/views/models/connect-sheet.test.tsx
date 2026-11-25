import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { HOME_HEADING, renderApp } from '../../helpers.tsx';

async function typeAndSend(text: string): Promise<void> {
  const box = await screen.findByRole('textbox', { name: '问一句' });
  fireEvent.change(box, { target: { value: text } });
  fireEvent.click(screen.getByRole('button', { name: '发送' }));
}

describe('Sending message without connected model', () => {
  it('opens connect-model modal quoting message and sends it after connecting with key', async () => {
    const app = await renderApp({ hash: '#/plasticine/main', modelConnected: false });
    const send = vi.spyOn(app.api.lines, 'send');
    await typeAndSend('帮我把这周的笔记整理成一篇周记');
    const sheet = await screen.findByRole('dialog', { name: '连上一个模型' });
    expect(sheet.textContent).toContain('连上后，这句接着发出');
    expect(sheet.textContent).toContain('帮我把这周的笔记整理成一篇周记');
    expect(send).not.toHaveBeenCalled();
    fireEvent.click(within(within(sheet).getByRole('listitem', { name: 'DeepSeek' })).getByRole('button',
      { name: '填 key' }));
    fireEvent.change(screen.getByLabelText('API Key'), { target: { value: 'sk-test-12345678' } });
    fireEvent.click(screen.getByRole('button', { name: '连接' }));
    await waitFor(() => expect(send).toHaveBeenCalledTimes(1));
    expect(send.mock.calls[0]?.[1].text).toBe('帮我把这周的笔记整理成一篇周记');
    await waitFor(() => expect(screen.queryByRole('dialog', { name: '连上一个模型' })).toBeNull());
  });

  it('closing modal cancels send and keeps original text in input box', async () => {
    const app = await renderApp({ hash: '#/plasticine/main', modelConnected: false });
    const send = vi.spyOn(app.api.lines, 'send');
    await typeAndSend('先放着');
    const sheet = await screen.findByRole('dialog', { name: '连上一个模型' });
    fireEvent.click(within(sheet).getByRole('button', { name: /关闭|关掉/ }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: '连上一个模型' })).toBeNull());
    expect(send).not.toHaveBeenCalled();
    expect((screen.getByRole('textbox', { name: '问一句' }) as HTMLTextAreaElement).value).toBe('先放着');
  });

  it('sends directly as usual when a model is connected', async () => {
    const app = await renderApp({ hash: '#/plasticine/main' });
    const send = vi.spyOn(app.api.lines, 'send');
    await typeAndSend('你好');
    await waitFor(() => expect(send).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole('dialog', { name: '连上一个模型' })).toBeNull();
  });
});

describe('Home Needs your attention', () => {
  it('shows single connect-model prompt when unconnected and removes it after connecting inline', async () => {
    await renderApp({ hash: '#/today', modelConnected: false });
    const section = await screen.findByRole('region', { name: '等你' });
    const row = within(section).getByText('连上模型后，定时的事才会跑');
    fireEvent.click(within(row.closest('li')!).getByRole('button', { name: '去连' }));
    const sheet = await screen.findByRole('dialog', { name: '连上一个模型' });
    fireEvent.click(within(within(sheet).getByRole('listitem', { name: 'DeepSeek' })).getByRole('button',
      { name: '填 key' }));
    fireEvent.change(screen.getByLabelText('API Key'), { target: { value: 'sk-test-12345678' } });
    fireEvent.click(screen.getByRole('button', { name: '连接' }));
    await waitFor(() => expect(screen.queryByText('连上模型后，定时的事才会跑')).toBeNull());
  });

  it('omits connect-model prompt when a model is connected', async () => {
    await renderApp({ hash: '#/today' });
    await screen.findByText(HOME_HEADING);
    expect(screen.queryByText('连上模型后，定时的事才会跑')).toBeNull();
  });
});
