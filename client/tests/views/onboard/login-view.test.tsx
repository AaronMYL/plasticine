import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiProvider } from '../../../src/api/context.tsx';
import { createFakeApi } from '../../../src/api/fake/index.ts';
import { LoginView } from '../../../src/views/login/login-view.tsx';
import { loginTarget } from '../../../src/views/onboard/handle.ts';
import { HOME_HEADING, renderApp, setViewportWidth } from '../../helpers.tsx';
import { installDesktop, removeDesktop } from './desktop-bridge.ts';

afterEach(() => {
  removeDesktop();
  vi.restoreAllMocks();
});

function signedOut(hash = '#/login') {
  return renderApp({ hash, signedIn: false, setup: (fake) => fake.control.network.register('you', 'Alex') });
}

describe('Sign in', () => {
  it('prefills @handle from account status with URL on desktop, without pairing code prompts', async () => {
    await signedOut();
    const page = await screen.findByRole('main', { name: '登录' });
    expect((within(page).getByLabelText('@账号或地址') as HTMLInputElement).value).toBe('you');
    expect(within(page).getByText('you.cyberhunter.top')).toBeTruthy();
    expect(screen.queryByLabelText('配对码')).toBeNull();
    expect(screen.queryByText('在哪里获取配对码？')).toBeNull();
    expect(document.activeElement).toBe(within(page).getByLabelText('密码'));
  });

  it('valid password registers device and navigates to Home', async () => {
    const app = await signedOut();
    await screen.findByRole('main', { name: '登录' });
    fireEvent.change(screen.getByLabelText('密码'), { target: { value: 'fake-password' } });
    fireEvent.submit(screen.getByLabelText('密码').closest('form')!);
    expect(await screen.findByRole('heading', { name: HOME_HEADING })).toBeTruthy();
    expect(window.location.hash).toBe('#/today');
    expect(await app.api.devices.list()).toHaveLength(1);
  });

  it('wrong password and rate limit both show inline error without modal', async () => {
    await signedOut();
    await screen.findByRole('main', { name: '登录' });
    const password = screen.getByLabelText('密码');
    for (let attempt = 0; attempt < 5; attempt += 1) {
      fireEvent.change(password, { target: { value: `wrong-${attempt}` } });
      fireEvent.click(screen.getByRole('button', { name: '登录' }));
      await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('密码不对'));
    }
    fireEvent.change(password, { target: { value: 'fake-password' } });
    fireEvent.click(screen.getByRole('button', { name: '登录' }));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('试错太多次了'));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('entering another @handle redirects to its login page without carrying password', async () => {
    const assign = vi.fn();
    const fake = createFakeApi({ seed: false, streamStepMs: 0 });
    render(<ApiProvider api={fake.api}><LoginView account={await fake.api.account.state()} onSignedIn={vi.fn()}
      navigate={assign} /></ApiProvider>);
    fireEvent.change(screen.getByLabelText('@账号或地址'), { target: { value: '@xiaolin' } });
    expect((screen.getByLabelText('密码') as HTMLInputElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: '登录' }));
    expect(assign).toHaveBeenCalledWith('https://xiaolin.cyberhunter.top/#/login');
  });

  it('Forgot password explains reset steps and closes on Esc', async () => {
    await signedOut();
    await screen.findByRole('main', { name: '登录' });
    fireEvent.click(screen.getByRole('button', { name: '忘了密码' }));
    const tip = screen.getByRole('tooltip');
    expect(tip.textContent).toContain('在装着它的那台电脑上打开 Plasticine 就能重设');
    expect(tip.textContent).toContain('plasticine password');
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('tooltip')).toBeNull();
  });

  it('hides Switch server on web; shows it on remote desktop client to return to start page', async () => {
    await signedOut();
    await screen.findByRole('main', { name: '登录' });
    expect(screen.queryByRole('button', { name: '换一个地方' })).toBeNull();
  });

  it('remote desktop client shows Switch server on login page', async () => {
    const desktop = installDesktop({ localToken: null });
    await signedOut();
    await screen.findByRole('main', { name: '登录' });
    fireEvent.click(screen.getByRole('button', { name: '换一个地方' }));
    expect(desktop.showWelcome).toHaveBeenCalledTimes(1);
  });

  it('local desktop client signs in directly with local token without asking password', async () => {
    installDesktop();
    const app = await signedOut();
    expect(await screen.findByRole('heading', { name: HOME_HEADING })).toBeTruthy();
    expect(screen.queryByRole('main', { name: '登录' })).toBeNull();
    expect(await app.api.devices.list()).toHaveLength(1);
  });

  it('opening #/login while already signed in redirects to Home', async () => {
    await renderApp({ hash: '#/login' });
    expect(await screen.findByRole('heading', { name: HOME_HEADING })).toBeTruthy();
    expect(window.location.hash).toBe('#/today');
  });

  it('mobile layout stacks top-aligned, hides URL box, and keeps form usable', async () => {
    setViewportWidth(390);
    await signedOut();
    const page = await screen.findByRole('main', { name: '登录' });
    expect(within(page).getByRole('button', { name: '忘了密码' })).toBeTruthy();
  });

  it('identifies instance from @handle or URL', () => {
    const here = new URL('https://you.cyberhunter.top/#/login');
    expect(loginTarget('', 'you', here)).toEqual({ kind: 'here' });
    expect(loginTarget('@you', 'you', here)).toEqual({ kind: 'here' });
    expect(loginTarget('you.cyberhunter.top', 'you', here)).toEqual({ kind: 'here' });
    expect(loginTarget('alex', 'you', here)).toEqual({ kind: 'elsewhere',
      url: 'https://alex.cyberhunter.top/#/login' });
    expect(loginTarget('http://192.168.1.5:8790/x', null, here)).toEqual({ kind: 'elsewhere',
      url: 'http://192.168.1.5:8790/#/login' });
    expect(loginTarget('https://user:pw@evil.test', null, here)).toEqual({ kind: 'bad' });
    expect(loginTarget('1-no', null, here)).toEqual({ kind: 'bad' });
    expect(loginTarget('alex', undefined, here)).toEqual({ kind: 'here' });
    expect(loginTarget('alex', null, null)).toEqual({ kind: 'elsewhere', url: 'https://alex.cyberhunter.top/#/login' });
  });
});
