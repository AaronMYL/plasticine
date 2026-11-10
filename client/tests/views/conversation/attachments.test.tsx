import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { renderApp, memoryStorage } from '../../helpers.tsx';

afterEach(() => vi.unstubAllGlobals());

it('图片选中立即显示本机缩略图，替换会取消旧上传并保持原来位置', async () => {
  const create = vi.fn((file: Blob) => `blob:${file.size}`);
  const revoke = vi.fn();
  vi.stubGlobal('URL', class extends URL {
    static override createObjectURL = create;
    static override revokeObjectURL = revoke;
  });
  const app = await renderApp({ hash: '#/conversation' });
  const upload = app.api.attachments.upload.bind(app.api.attachments);
  let oldSignal: AbortSignal | undefined;
  let release = (): void => undefined;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  vi.spyOn(app.api.attachments, 'upload').mockImplementation(async (input, signal) => {
    if (input.name === '原图.png') { oldSignal = signal; await gate; }
    return upload(input);
  });
  fireEvent.change(screen.getByLabelText('选择对话附件'), { target: { files: [
    new File(['png'], '原图.png', { type: 'image/png' }),
    new File(['笔记'], '笔记.txt', { type: 'text/plain' }),
  ] } });
  expect(screen.getByRole('img', { name: '预览 原图.png' }).getAttribute('src')).toBe('blob:3');
  await waitFor(() => expect(oldSignal).toBeDefined());
  fireEvent.change(screen.getByLabelText('替换附件 原图.png'), {
    target: { files: [new File(['new png'], '新图.png', { type: 'image/png' })] },
  });
  expect(oldSignal?.aborted).toBe(true);
  expect(app.state.attachments.active().map((row) => row.name)).toEqual(['新图.png', '笔记.txt']);
  expect(revoke).toHaveBeenCalledWith('blob:3');
  await act(async () => { release(); await gate; });
  await waitFor(() => expect(app.state.attachments.ready()).toBe(true));
  expect(screen.queryByRole('img', { name: '预览 原图.png' })).toBeNull();
});

it('上传进度使用传输回执，失败后用同一文件重试，不用重新选择', async () => {
  const app = await renderApp({ hash: '#/conversation' });
  const upload = app.api.attachments.upload.bind(app.api.attachments);
  let fail = (): void => undefined;
  const gate = new Promise<void>((_resolve, reject) => { fail = () => reject(new Error('连接中断')); });
  const send = vi.spyOn(app.api.attachments, 'upload').mockImplementationOnce(async (_input, _signal, progress) => {
    progress?.(0.4);
    await gate;
    throw new Error('不会到这里');
  }).mockImplementation(upload);
  fireEvent.change(screen.getByLabelText('选择对话附件'), {
    target: { files: [new File(['文稿'], '草稿.txt', { type: 'text/plain' })] },
  });
  await waitFor(() => expect(screen.getByRole('progressbar', { name: '正在上传 草稿.txt' })
    .getAttribute('aria-valuenow')).toBe('40'));
  await act(async () => { fail(); await gate.catch(() => undefined); });
  fireEvent.click(await screen.findByRole('button', { name: '重试上传 草稿.txt' }));
  await waitFor(() => expect(app.state.attachments.ready()).toBe(true));
  expect(send).toHaveBeenCalledTimes(2);
  expect(send.mock.calls[1]?.[0]).toEqual(send.mock.calls[0]?.[0]);
});

it('发送失败仍展示原附件，重试携带同一附件和请求标识', async () => {
  const app = await renderApp({ hash: '#/conversation' });
  const send = app.api.lines.send.bind(app.api.lines);
  const sent = vi.spyOn(app.api.lines, 'send').mockRejectedValueOnce(new Error('网络中断')).mockImplementation(send);
  fireEvent.change(screen.getByLabelText('选择对话附件'), {
    target: { files: [new File(['image'], '示例.png', { type: 'image/png' })] },
  });
  await waitFor(() => expect(app.state.attachments.ready()).toBe(true));
  fireEvent.change(screen.getByLabelText('问一句'), { target: { value: '看看这张图' } });
  fireEvent.click(screen.getByRole('button', { name: '发送' }));
  expect(await screen.findByText(/没发出：.*网络中断/)).toBeTruthy();
  expect(await screen.findByRole('button', { name: '查看图片 示例.png' })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '重试' }));
  await waitFor(() => expect(sent).toHaveBeenCalledTimes(2));
  expect(sent.mock.calls[1]?.[1]).toEqual(sent.mock.calls[0]?.[1]);
  expect(sent.mock.calls[1]?.[1].attachments).toHaveLength(1);
  expect(await screen.findByRole('button', { name: '查看图片 示例.png' })).toBeTruthy();
});

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
