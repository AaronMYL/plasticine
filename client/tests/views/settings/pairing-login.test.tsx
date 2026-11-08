import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ApiProvider } from '../../../src/api/context.tsx';
import { createFakeApi } from '../../../src/api/fake/index.ts';
import { LoginView } from '../../../src/views/login/login-view.tsx';
import { pairingLink } from '../../../src/views/login/pairing-link.ts';
import { setViewportWidth } from '../../helpers.tsx';

describe('新设备确认配对邀请', () => {
  it('扫码只预填邀请，确认前不换会话；回执成功后才显示已连接，点打开进入应用', async () => {
    setViewportWidth(390);
    const fake = createFakeApi({ seed: false, streamStepMs: 0, now: () => new Date() });
    const code = fake.control.session.issueCode();
    const link = pairingLink(window.location.origin, {
      code, expiresAt: new Date(Date.now() + 60_000).toISOString(),
    });
    window.history.replaceState(null, '', link);
    const pair = vi.spyOn(fake.api.session, 'pair');
    const onPaired = vi.fn();
    render(<ApiProvider api={fake.api}><LoginView onPaired={onPaired} /></ApiProvider>);
    expect(pair).not.toHaveBeenCalled();
    expect(window.location.hash).not.toContain(code);
    expect(screen.getByRole('heading', { name: '连接到 Plasticine' })).toBeTruthy();
    fireEvent.change(screen.getByLabelText('设备名称'), { target: { value: '新手机' } });
    fireEvent.click(screen.getByRole('button', { name: '连接这台手机' }));
    await screen.findByRole('heading', { name: '这台手机已连接' });
    expect(pair.mock.calls[0]?.[0].code).toBe(code);
    expect(pair.mock.calls[0]?.[0].deviceName).toBe('新手机');
    expect(onPaired).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '打开 Plasticine' }));
    expect(onPaired).toHaveBeenCalledWith(await fake.api.session.current());
  });

  it('过期邀请说明从原设备重新生成，能改用新的备用码', async () => {
    const fake = createFakeApi({ seed: false, streamStepMs: 0 });
    window.history.replaceState(null, '', pairingLink(window.location.origin, {
      code: fake.control.session.issueCode(), expiresAt: '2020-01-01T00:00:00.000Z',
    }));
    const pair = vi.spyOn(fake.api.session, 'pair');
    render(<ApiProvider api={fake.api}><LoginView onPaired={vi.fn()} /></ApiProvider>);
    expect(screen.getByRole('heading', { name: '配对邀请已过期' })).toBeTruthy();
    expect(pair).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '输入新的配对码' }));
    expect(screen.getByLabelText('配对码')).toBeTruthy();
  });

  it('新设备的配对回执丢失，重试沿用同一个操作标识，不重复注册', async () => {
    setViewportWidth(390);
    const fake = createFakeApi({ seed: false, streamStepMs: 0, now: () => new Date() });
    window.history.replaceState(null, '', pairingLink(window.location.origin, {
      code: fake.control.session.issueCode(), expiresAt: new Date(Date.now() + 60_000).toISOString(),
    }));
    fake.control.faults.next('pair', { kind: 'uncertain', landed: true });
    const pair = vi.spyOn(fake.api.session, 'pair');
    render(<ApiProvider api={fake.api}><LoginView onPaired={vi.fn()} /></ApiProvider>);
    fireEvent.click(screen.getByRole('button', { name: '连接这台手机' }));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('结果待核实'));
    expect(screen.queryByRole('heading', { name: '这台手机已连接' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '连接这台手机' }));
    await screen.findByRole('heading', { name: '这台手机已连接' });
    expect(pair.mock.calls[1]?.[0].requestId).toBe(pair.mock.calls[0]?.[0].requestId);
    expect(await fake.api.devices.list()).toHaveLength(1);
  });
});
