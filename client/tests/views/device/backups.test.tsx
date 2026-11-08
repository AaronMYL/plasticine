import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { NOW, renderApp, seedNote } from '../../helpers.tsx';
import { ApiProvider } from '../../../src/api/context.tsx';
import { uncertainError } from '../../../src/api/errors.ts';
import { createFakeApi } from '../../../src/api/fake/index.ts';
import { FakePushDevice } from '../../../src/api/fake/fake-push-device.ts';
import { PushDeviceContext } from '../../../src/api/push-device.ts';
import { LiveProvider } from '../../../src/live.tsx';
import { ClientStateProvider, createClientState } from '../../../src/state/context.tsx';
import { BackupRestoreCard } from '../../../src/views/device/backup-restore-card.tsx';
import { BackupComparison } from '../../../src/views/device/backup-comparison.tsx';
import { backupFieldLabel, backupFieldValue } from '../../../src/views/device/backup-labels.ts';

afterEach(() => vi.unstubAllGlobals());

it.each([
  { width: 1440, private: true }, { width: 1440, private: false },
  { width: 390, private: true }, { width: 390, private: false },
])('$width 像素 private=$private：预览关闭设置并显示正文，真正恢复仍等本人确认', async (input) => {
  const app = await renderApp({ width: input.width,
    setup: (fake) => seedNote(fake, 'backup_note', '# 备忘', { private: input.private }) });
  await act(async () => {
    await app.api.backups.create({ requestId: 'req_private_backup_ui' });
    app.control.notes.externalEdit('backup_note', '# 备忘\n\n当前内容');
  });
  const preview = vi.spyOn(app.api.backups, 'preview');
  const send = vi.spyOn(app.api.signed, 'send');
  fireEvent.click(screen.getByRole('button', { name: /^设置 ·/ }));
  const settings = await screen.findByRole('dialog', { name: '设置' });
  fireEvent.click(within(settings).getByRole('button', { name: '系统' }));
  fireEvent.click(await within(settings).findByRole('button', { name: '全部备份' }));
  const backups = await screen.findByRole('dialog', { name: '本机备份' });
  fireEvent.click(await within(backups).findByRole('button', { name: /^查看备份 / }));
  fireEvent.click(await within(backups).findByRole('button', { name: /^预览恢复 / }));
  expect(screen.queryByRole('button', { name: /解锁/ })).toBeNull();
  await waitFor(() => expect(preview).toHaveBeenCalledTimes(1));
  const restore = await screen.findByRole('dialog', { name: '按对象恢复' });
  await waitFor(() => expect(document.querySelector('.settings-dialog')).toBeNull());
  expect(screen.queryByRole('dialog', { name: '本机备份' })).toBeNull();
  expect(window.location.hash).toBe('#/today');
  expect(await within(restore).findByText('当前内容')).toBeTruthy();
  expect(within(restore).getByRole('heading', { level: 3 }).textContent).toContain('会先保存现在的版本');
  expect(send).not.toHaveBeenCalled();
  fireEvent.click(within(restore).getByRole('button', { name: '确认恢复' }));
  await within(restore).findByText('这个对象已恢复为新版本。');
  expect(send).toHaveBeenCalledTimes(1);
  expect(send.mock.calls[0]![0].target.kind).toBe('backup_restore');
  expect(await app.api.notes.get('backup_note')).toMatchObject({ private: input.private, markdown: '# 备忘' });
});

async function restoreCard() {
  const fake = createFakeApi({ seed: false, now: () => NOW, streamStepMs: 0 });
  fake.control.session.signInForDevelopment('旧浏览器');
  fake.control.session.backdate(11 * 60 * 1000);
  seedNote(fake, 'note_restore', '# 备份里的正文');
  const backup = await fake.api.backups.create({ requestId: 'req_backup_original' });
  fake.control.notes.externalEdit('note_restore', '# 现在的正文');
  const preview = await fake.api.backups.preview(backup.id,
    { requestId: 'req_backup_preview', kind: 'note', objectId: 'note_restore' });
  const state = createClientState();
  await act(async () => {
    render(<ApiProvider api={fake.api}><ClientStateProvider state={state}>
      <PushDeviceContext.Provider value={new FakePushDevice()}><LiveProvider>
        <BackupRestoreCard id={preview.id} />
      </LiveProvider></PushDeviceContext.Provider>
    </ClientStateProvider></ApiProvider>);
  });
  return { ...fake, state, preview, button: await screen.findByRole('button', { name: '确认恢复' }) };
}

it('没有 WebCrypto 或钥匙存储的老会话能核对后恢复，仍保留恢复后果与用户点击', async () => {
  const original = globalThis.crypto;
  vi.stubGlobal('crypto', { randomUUID: original.randomUUID.bind(original) });
  vi.stubGlobal('indexedDB', undefined);
  const app = await restoreCard();
  const send = vi.spyOn(app.api.signed, 'send');
  expect(app.button.hasAttribute('disabled')).toBe(false);
  expect(screen.getByRole('heading', { level: 3 }).textContent).toContain('会先保存现在的版本');
  expect(screen.queryByText(/签名钥匙|重新配对后才能/)).toBeNull();
  expect(send).not.toHaveBeenCalled();
  expect((await app.api.notes.get('note_restore')).markdown).toBe('# 现在的正文');
  fireEvent.click(app.button);
  await screen.findByText('这个对象已恢复为新版本。');
  expect((await app.api.notes.get('note_restore')).markdown).toBe('# 备份里的正文');
  expect((await app.api.backups.list()).backups).toHaveLength(2);
  const request = send.mock.calls[0]![0];
  expect(request).toEqual({ target: { kind: 'backup_restore', backupId: app.preview.backupId },
    bodyText: request.bodyText });
  expect(JSON.parse(request.bodyText)).toMatchObject({ previewId: app.preview.id, digest: app.preview.digest,
    askVersion: app.preview.askVersion, backupName: app.preview.backupName });
});

it('恢复回执丢失后沿用原请求核实，不重复恢复或删除恢复前的备份', async () => {
  const app = await restoreCard();
  const original = app.api.signed.send.bind(app.api.signed);
  const send = vi.spyOn(app.api.signed, 'send').mockImplementationOnce(async (request) => {
    await original(request);
    throw uncertainError('恢复对象');
  });
  fireEvent.click(app.button);
  await waitFor(() => expect(app.state.actionOps.hasPending()).toBe(true));
  const retry = await screen.findByRole('button', { name: '再核实恢复' });
  await waitFor(() => expect(retry.hasAttribute('disabled')).toBe(false));
  const version = (await app.api.notes.get('note_restore')).version;
  fireEvent.click(retry);
  await waitFor(() => expect(app.state.actionOps.hasPending()).toBe(false));
  expect(send.mock.calls[1]![0]).toEqual(send.mock.calls[0]![0]);
  expect((await app.api.notes.get('note_restore')).version).toBe(version);
  expect((await app.api.backups.list()).backups).toHaveLength(2);
});

it('词表备份的嵌套对照用日常词（用法：精确 / 比喻），差异展开、共同内容折叠', () => {
  const { container } = render(
    <BackupComparison
      kind="agreement"
      before={JSON.stringify({ proposedTerm: { text: '原定义', termTier: 'exact' } })}
      after={JSON.stringify({ proposedTerm: { text: '新定义', termTier: 'metaphor' } })}
    />,
  );
  expect(container.textContent).toContain('用法：精确');
  expect(container.textContent).toContain('用法：比喻');
  expect(container.textContent).not.toContain('档位');
  expect(container.textContent).not.toMatch(/proposedTerm|termTier|metaphor|exact/);
  expect(screen.getAllByText('差异内容').every((node) => node.parentElement?.hasAttribute('open'))).toBe(true);
  expect(screen.getAllByText('前面相同的内容').every((node) => !node.parentElement?.hasAttribute('open'))).toBe(true);
});

it('备份标签不用行话：证据种类写「实际结果」，定义域写「范围」（第 5 批用词收尾）', () => {
  expect(backupFieldValue('kind', 'outcome')).toBe('实际结果');
  expect(backupFieldLabel('scope')).toBe('范围');
  expect(backupFieldLabel('termTier')).toBe('用法');
});
