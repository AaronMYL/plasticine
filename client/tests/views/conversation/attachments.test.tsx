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
  vi.spyOn(app.api.attachments, 'upload').mockImplementation(async (input, data, signal) => {
    if (input.name === '原图.png') { oldSignal = signal; await gate; }
    return upload(input, data);
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
  const send = vi.spyOn(app.api.attachments, 'upload').mockImplementationOnce(async (_input, _data, _signal,
    progress) => {
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
  vi.spyOn(app.api.attachments, 'upload').mockImplementation(async (input, data) => {
    await gate;
    return upload(input, data);
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
  vi.spyOn(app.api.attachments, 'upload').mockImplementation(async (input, data) => {
    await gate;
    return upload(input, data);
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

it('任意类型都能加（第13批）：压缩包是一枚小条（文件形状 + 名字），发出去以后在对话里点了直接下载', async () => {
  const app = await renderApp({ hash: '#/conversation' });
  fireEvent.change(screen.getByLabelText('选择对话附件'), {
    target: { files: [new File(['PK zip'], '全部素材.zip', { type: 'application/zip' })] },
  });
  await waitFor(() => expect(app.state.attachments.ready()).toBe(true));
  const chip = screen.getByText('全部素材.zip').closest('.conv-attachment-chip');
  expect(chip?.querySelector('.file-ext')).not.toBeNull();
  expect(app.state.attachments.active()[0]?.remote?.mimeType).toBe('application/zip');
  fireEvent.click(screen.getByRole('button', { name: '发送' }));
  const link = await screen.findByRole('link', { name: '下载 全部素材.zip' });
  expect(link.getAttribute('download')).toBe('全部素材.zip');
  expect(link.querySelector('.file-ext')?.textContent).toBe('ZIP');
});

it('超过 100 MB、空文件不加，输入框上方一行写清是哪一份；× 能关，关了不占地方', async () => {
  const app = await renderApp({ hash: '#/conversation' });
  const big = new File(['x'], '全部素材.zip', { type: 'application/zip' });
  Object.defineProperty(big, 'size', { value: 101 * 1024 * 1024 });
  fireEvent.change(screen.getByLabelText('选择对话附件'), {
    target: { files: [big, new File([], '空.txt', { type: 'text/plain' })] },
  });
  const alert = await screen.findByRole('alert');
  expect(alert.textContent).toContain('「全部素材.zip」超过 100 MB，没有加上；「空.txt」是空文件，没有加上');
  expect(app.state.attachments.active()).toHaveLength(0);
  fireEvent.click(screen.getByRole('button', { name: '关掉这条提示' }));
  await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
  expect(app.state.attachments.error.get()).toBeNull();
});

it('提示 6 秒后自己收', async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  try {
    const app = await renderApp({ hash: '#/conversation' });
    act(() => app.state.attachments.error.set('「表.xlsx」没传上去：连接中断'));
    expect(screen.getByRole('alert').textContent).toContain('「表.xlsx」没传上去');
    await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
    expect(screen.queryByRole('alert')).not.toBeNull();
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    await act(async () => { await vi.advanceTimersByTimeAsync(300); });
    expect(screen.queryByRole('alert')).toBeNull();
  } finally {
    vi.useRealTimers();
  }
});

it('没传上去的写在那一行（哪一份、为什么），重新传成功后收起', async () => {
  const app = await renderApp({ hash: '#/conversation' });
  const upload = app.api.attachments.upload.bind(app.api.attachments);
  vi.spyOn(app.api.attachments, 'upload').mockRejectedValueOnce(new Error('连接中断')).mockImplementation(upload);
  fireEvent.change(screen.getByLabelText('选择对话附件'), {
    target: { files: [new File(['a,b'], '投递记录.csv', { type: 'text/csv' })] },
  });
  expect((await screen.findByRole('alert')).textContent).toContain('「投递记录.csv」没传上去：连接中断');
  fireEvent.click(screen.getByRole('button', { name: '重试上传 投递记录.csv' }));
  await waitFor(() => expect(app.state.attachments.ready()).toBe(true));
  await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
});
