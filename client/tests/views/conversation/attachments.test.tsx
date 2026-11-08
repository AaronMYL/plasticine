import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { renderApp, memoryStorage } from '../../helpers.tsx';

it('浏览器提供 Markdown、CSV 和 JSON 类型时也能上传', async () => {
  const app = await renderApp({ hash: '#/conversation' });
  const files = [new File(['# 中文'], '稿.md', { type: 'text/markdown' }),
    new File(['a,b'], '表.csv', { type: 'text/csv' }),
    new File(['{}'], '数据.json', { type: 'application/json' })];
  fireEvent.change(screen.getByLabelText('选择对话附件'), { target: { files } });
  await waitFor(() => expect(app.state.attachments.active()).toHaveLength(3));
  await waitFor(() => expect(app.state.attachments.ready()).toBe(true));
  expect(app.state.attachments.active().map((row) => row.remote?.mimeType))
    .toEqual(['text/markdown', 'text/csv', 'application/json']);
});

it('移除正在上传的附件立即消失，迟到结果不会恢复它或留下红色错误', async () => {
  const app = await renderApp({ hash: '#/conversation' });
  const upload = app.api.attachments.upload.bind(app.api.attachments);
  let finish: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => { finish = resolve; });
  vi.spyOn(app.api.attachments, 'upload').mockImplementation(async (input) => {
    await gate;
    return upload(input);
  });
  fireEvent.change(screen.getByLabelText('选择对话附件'), {
    target: { files: [new File(['文稿'], '未完成.txt', { type: 'text/plain' })] },
  });
  await screen.findByText('正在上传');
  fireEvent.click(screen.getByRole('button', { name: '移除附件 未完成.txt' }));
  expect(screen.queryByText('未完成.txt')).toBeNull();
  expect(screen.queryByText(/已移除的上传/)).toBeNull();
  expect(app.state.attachments.hasAny()).toBe(false);
  expect(screen.queryByRole('alert')).toBeNull();
  await act(async () => { finish(); await gate; });
  await waitFor(() => expect(app.state.actionOps.store.get()).toHaveLength(0));
  expect(app.state.attachments.hasAny()).toBe(false);
});

it('一次选取的所有文件在读取前占位，并发再选不能突破五份上限', async () => {
  const app = await renderApp({ hash: '#/conversation' });
  const files = Array.from({ length: 5 }, (_, i) => new File(['x'], `${i}.txt`, { type: 'text/plain' }));
  fireEvent.change(screen.getByLabelText('选择对话附件'), { target: { files } });
  expect(app.state.attachments.active()).toHaveLength(5);
  fireEvent.change(screen.getByLabelText('选择对话附件'), { target: { files: [files[0]] } });
  expect(app.state.attachments.active()).toHaveLength(5);
  await screen.findByText('一条消息最多 5 份附件。');
  await waitFor(() => expect(app.state.attachments.ready()).toBe(true));
});

it('上传未就绪不静默丢文件发送，取消后迟到回执不加回输入框', async () => {
  const app = await renderApp({ hash: '#/conversation' });
  const upload = app.api.attachments.upload.bind(app.api.attachments);
  let release: (() => void) | undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  vi.spyOn(app.api.attachments, 'upload').mockImplementation(async (input) => {
    await gate;
    return upload(input);
  });
  fireEvent.change(screen.getByLabelText('选择对话附件'), {
    target: { files: [new File(['文稿'], '待传.txt', { type: 'text/plain' })] },
  });
  await screen.findByText('正在上传');
  fireEvent.change(screen.getByLabelText('问一句'), { target: { value: '一起读' } });
  expect(screen.getByRole('button', { name: '发送' }).hasAttribute('disabled')).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: '移除附件 待传.txt' }));
  await act(async () => {
    release?.();
    await gate;
  });
  await waitFor(() => expect(screen.queryByText('待传.txt')).toBeNull());
  expect(app.state.attachments.active()).toHaveLength(0);
});
