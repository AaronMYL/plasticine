import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FAKE_LOCAL_TOKEN, FAKE_SETUP_TOKEN } from '../../../src/api/fake/fake-account.ts';
import { renderApp } from '../../helpers.tsx';
import { installDesktop, removeDesktop } from './desktop-bridge.ts';

afterEach(() => {
  removeDesktop();
  window.localStorage.clear();
  vi.restoreAllMocks();
});

function fresh(hash = '#/today', register = false) {
  return renderApp({ hash, signedIn: false, modelConnected: false, setup: (fake) => {
    fake.control.account.seedFresh();
    if (register) fake.control.network.register('alex', 'Alex');
  } });
}

function fill(name: string, handle: string, password: string): void {
  fireEvent.change(screen.getByLabelText('叫你什么'), { target: { value: name } });
  if (handle !== '') fireEvent.change(screen.getByLabelText('@账号'), { target: { value: handle } });
  fireEvent.change(screen.getByLabelText('密码'), { target: { value: password } });
}

describe('Create account', () => {
  it('unclaimed instance shows greeting and 4-field card defaulting name to Plasticine, no pairing', async () => {
    await fresh();
    const page = await screen.findByRole('main', { name: '建账号' });
    expect(page.textContent).toContain('你好，我是 Plasticine。先把账号建好，再连一个模型。');
    expect((screen.getByLabelText('叫我什么') as HTMLInputElement).value).toBe('Plasticine');
    expect(screen.getByLabelText('@账号')).toBeTruthy();
    expect(screen.queryByLabelText('配对码')).toBeNull();
    expect(screen.queryByRole('img', { name: /第 \d 步/ })).toBeNull();
    expect(within(page).getByRole('button', { name: '创建' }).hasAttribute('disabled')).toBe(true);
  });

  it('debounces @handle availability/format check and shows mobile URL below', async () => {
    const app = await fresh();
    await screen.findByRole('main', { name: '建账号' });
    const handle = vi.spyOn(app.api.account, 'handle');
    const input = screen.getByLabelText('@账号');
    fireEvent.change(input, { target: { value: 'ale' } });
    fireEvent.change(input, { target: { value: 'alex' } });
    expect(await screen.findByText('能用')).toBeTruthy();
    expect(handle).toHaveBeenCalledTimes(1);
    expect(screen.getByText('手机和别的电脑用 alex.cyberhunter.top 打开')).toBeTruthy();
    fireEvent.change(input, { target: { value: 'taken' } });
    expect(await screen.findByText('被占了')).toBeTruthy();
    fireEvent.change(input, { target: { value: 'al-ex' } });
    expect(await screen.findByText('格式不对')).toBeTruthy();
  });

  it('blocks creation without @handle so instance joins network on setup', async () => {
    installDesktop();
    await fresh();
    await screen.findByRole('main', { name: '建账号' });
    fill('Alex', '', 'fake-pass-1234');
    expect(screen.getByRole('button', { name: '创建' }).hasAttribute('disabled')).toBe(true);
  });

  it('desktop prefills OS full name, creates with local token, lands on main with connect-model card', async () => {
    const desktop = installDesktop({ profile: { fullName: '牟元礼', apps: [] } });
    const app = await fresh();
    await screen.findByRole('main', { name: '建账号' });
    await waitFor(() => expect((screen.getByLabelText('叫你什么') as HTMLInputElement).value).toBe('牟元礼'));
    const setup = vi.spyOn(app.api.account, 'setup');
    fill('Alex', 'alex', 'fake-pass-1234');
    await screen.findByText('能用');
    fireEvent.submit(screen.getByLabelText('密码').closest('form')!);
    const card = await screen.findByRole('region', { name: '连上一个模型' });
    expect(within(card).getByRole('listitem', { name: 'ChatGPT' })).toBeTruthy();
    expect(setup.mock.calls[0]?.[0]).toMatchObject({ displayName: 'Alex', handle: 'alex' });
    expect(setup.mock.calls[0]?.[1]).toBe(FAKE_LOCAL_TOKEN);
    expect(window.location.hash).toBe('#/plasticine/main');
    expect(desktop.showWelcome).not.toHaveBeenCalled();
  });

  it('customizing assistant name renames main thread and signs welcome card with it', async () => {
    installDesktop();
    const app = await fresh();
    await screen.findByRole('main', { name: '建账号' });
    const update = vi.spyOn(app.api.mates, 'updateMain');
    fill('Alex', 'alex', 'fake-pass-1234');
    fireEvent.change(screen.getByLabelText('叫我什么'), { target: { value: '小满' } });
    await screen.findByText('能用');
    fireEvent.click(screen.getByRole('button', { name: '创建' }));
    expect(await screen.findByRole('article', { name: '小满 的欢迎' })).toBeTruthy();
    expect(update.mock.calls[0]?.[0]).toEqual({ requestId: expect.any(String) as string, name: '小满' });
  });

  it('skips rename call when assistant name is unchanged', async () => {
    installDesktop();
    const app = await fresh();
    await screen.findByRole('main', { name: '建账号' });
    const update = vi.spyOn(app.api.mates, 'updateMain');
    fill('Alex', 'alex', 'fake-pass-1234');
    await screen.findByText('能用');
    fireEvent.click(screen.getByRole('button', { name: '创建' }));
    await screen.findByRole('region', { name: '连上一个模型' });
    expect(update).not.toHaveBeenCalled();
  });

  it('pre-configured server @handle is locked read-only and creates account using ?t= token', async () => {
    const app = await fresh(`#/setup?t=${FAKE_SETUP_TOKEN}`, true);
    await screen.findByRole('main', { name: '建账号' });
    expect(screen.getByText('@alex')).toBeTruthy();
    expect(screen.getByRole('img', { name: '安装时已经起好' })).toBeTruthy();
    expect(screen.queryByLabelText('@账号')).toBeNull();
    const setup = vi.spyOn(app.api.account, 'setup');
    fill('Alex', '', 'fake-pass-1234');
    fireEvent.click(screen.getByRole('button', { name: '创建' }));
    await screen.findByRole('region', { name: '连上一个模型' });
    expect(setup.mock.calls[0]?.[0]).toMatchObject({ handle: null, setupToken: FAKE_SETUP_TOKEN });
    expect(setup.mock.calls[0]?.[1]).toBeNull();
  });

  it('missing token shows inline error without modal while preserving entered fields', async () => {
    await fresh();
    await screen.findByRole('main', { name: '建账号' });
    fill('Alex', 'alex', 'fake-pass-1234');
    await screen.findByText('能用');
    fireEvent.click(screen.getByRole('button', { name: '创建' }));
    expect((await screen.findByRole('alert')).textContent).toContain('建账号链接过期了');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect((screen.getByLabelText('叫你什么') as HTMLInputElement).value).toBe('Alex');
  });

  it('blocks passwords under 8 chars and toggles password visibility with eye icon', async () => {
    await fresh();
    await screen.findByRole('main', { name: '建账号' });
    fill('Alex', 'alex', 'short');
    expect(screen.getByText('至少 8 位')).toBeTruthy();
    expect(screen.getByRole('button', { name: '创建' }).hasAttribute('disabled')).toBe(true);
    const password = screen.getByLabelText('密码') as HTMLInputElement;
    expect(password.type).toBe('password');
    fireEvent.click(screen.getByRole('button', { name: '显示密码' }));
    expect(password.type).toBe('text');
  });

  it('Switch server appears only in desktop client', async () => {
    await fresh();
    await screen.findByRole('main', { name: '建账号' });
    expect(screen.queryByRole('button', { name: '换一个地方' })).toBeNull();
  });

  it('clicking Switch server in desktop client calls server.showWelcome()', async () => {
    const desktop = installDesktop({ localToken: null });
    await fresh();
    await screen.findByRole('main', { name: '建账号' });
    fireEvent.click(screen.getByRole('button', { name: '换一个地方' }));
    await waitFor(() => expect(desktop.showWelcome).toHaveBeenCalledTimes(1));
  });
});
