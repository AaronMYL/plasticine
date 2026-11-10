import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { expect, it } from 'vitest';
import { renderApp } from '../../helpers.tsx';

it('联系人可粘贴文件，空文字带附件发送后仍显示原附件', async () => {
  const app = await renderApp({ hash: '#/messages/contact-media', setup: ({ control }) => {
    control.contacts.addPerson({ id: 'contact-media', name: '小蕨', handle: 'fern-example' });
  } });
  const input = await screen.findByRole('textbox', { name: '发给小蕨' });
  fireEvent.paste(input, { clipboardData: {
    files: [new File(['fixture note'], 'note.txt', { type: 'text/plain' })],
  } });
  const composer = within(input.closest('.contact-composer') as HTMLElement);
  await screen.findByLabelText('移除附件 note.txt');
  await waitFor(() => expect(composer.getByRole('button', { name: '发送' }).hasAttribute('disabled')).toBe(false));
  fireEvent.click(composer.getByRole('button', { name: '发送' }));
  await waitFor(async () => {
    const view = await app.api.contacts.messages('contact-media', {});
    const message = view.items.find((item) => item.type === 'message');
    expect(message?.type === 'message' ? message.message.attachments?.[0]?.name : null).toBe('note.txt');
  });
  expect(await screen.findByRole('button', { name: '预览文件 note.txt' })).toBeTruthy();
});

it('上传失败保留文件，重试沿用上传编号；过大文件不会进入发送请求', async () => {
  const app = await renderApp({ hash: '#/messages/contact-media', setup: ({ control }) => {
    control.contacts.addPerson({ id: 'contact-media', name: '小蕨', handle: 'fern-example' });
    control.faults.next('save', { kind: 'failed', message: '测试上传中断' });
  } });
  const input = await screen.findByRole('textbox', { name: '发给小蕨' });
  const composer = within(input.closest('.contact-composer') as HTMLElement);
  const file = new File(['fixture note'], 'note.txt', { type: 'text/plain' });
  fireEvent.change(screen.getByLabelText('选择消息附件'), { target: { files: [file] } });
  expect(await composer.findByText('测试上传中断')).toBeTruthy();
  expect(composer.getByRole('button', { name: '发送' }).hasAttribute('disabled')).toBe(true);
  fireEvent.click(composer.getByRole('button', { name: '重试上传 note.txt' }));
  await waitFor(() => expect(composer.getByRole('button', { name: '发送' }).hasAttribute('disabled')).toBe(false));
  expect(app.control.networkAttachments.rows.size).toBe(1);
  fireEvent.click(composer.getByRole('button', { name: '移除附件 note.txt' }));
  expect(composer.getByRole('button', { name: '发送' }).hasAttribute('disabled')).toBe(true);
  const oversized = new File(['too big'], 'large.bin');
  Object.defineProperty(oversized, 'size', { value: 26 * 1024 * 1024 });
  fireEvent.drop(input.closest('.contact-composer')!, { dataTransfer: { files: [oversized] } });
  expect(composer.getByText(/每份附件最多 25 MB/)).toBeTruthy();
  expect(app.control.networkAttachments.rows.size).toBe(1);
});

it('群组可拖入附件并保留附件编号', async () => {
  const app = await renderApp({ hash: '#/messages/grp-media', setup: ({ control }) => {
    control.contacts.addPerson({ id: 'contact-media', name: '小蕨', handle: 'fern-example' });
    control.contacts.groupChats.seed({ id: 'grp-media', name: '测试小组', avatar: null,
      members: [control.contacts.me, control.contacts.face('contact-media')!] });
  } });
  const input = await screen.findByRole('textbox', { name: '发给测试小组' });
  const composer = within(input.closest('.contact-composer') as HTMLElement);
  fireEvent.drop(input.closest('.contact-composer')!, { dataTransfer: {
    files: [new File(['fixture list'], 'list.txt', { type: 'text/plain' })],
  } });
  await waitFor(() => expect(composer.getByRole('button', { name: '发送' }).hasAttribute('disabled')).toBe(false));
  fireEvent.click(composer.getByRole('button', { name: '发送' }));
  await screen.findByRole('button', { name: '预览文件 list.txt' });
  const view = await app.api.contacts.messages('grp-media', {});
  const entry = view.items.find((item) => item.type === 'message' && item.message.author === 'me');
  expect(entry?.type === 'message' ? entry.message.attachments?.[0]?.name : null).toBe('list.txt');
});

it('失败消息重试沿用原消息与附件，成功后收起错误', async () => {
  const app = await renderApp({ hash: '#/messages/contact-media', setup: ({ control }) => {
    control.contacts.addPerson({ id: 'contact-media', name: '小蕨', handle: 'fern-example' });
    const attachment = { id: 'media-failed-fixture', name: 'list.txt', mimeType: 'text/plain',
      bytes: 1, sha256: 'a'.repeat(64), status: 'ready' as const, error: null };
    control.networkAttachments.seed(attachment, 'YQ==', 'contact-media', 'message-failed');
    control.contacts.post('contact-media', { id: 'message-failed', author: 'me', text: '',
      at: '2026-10-27T01:00:00.000Z', status: 'failed', error: '发送方连接中断', toAi: false,
      taskId: null, exchangeId: null, attachments: [attachment] });
  } });
  fireEvent.click(await screen.findByRole('button', { name: '重试发送' }));
  await waitFor(() => expect(screen.queryByRole('button', { name: '重试发送' })).toBeNull());
  const view = await app.api.contacts.messages('contact-media', {});
  const entry = view.items.find((item) => item.type === 'message');
  expect(entry?.type === 'message' ? entry.message.id : null).toBe('message-failed');
  expect(entry?.type === 'message' ? entry.message.attachments?.[0]?.id : null).toBe('media-failed-fixture');
});
