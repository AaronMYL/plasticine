import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FakeApi } from '../../../src/api/fake/index.ts';
import { renderApp } from '../../helpers.tsx';

afterEach(() => vi.restoreAllMocks());

async function section(): Promise<HTMLElement> {
  const pane = await screen.findByRole('dialog', { name: '设置' });
  return within(pane).findByRole('region', { name: '在别的设备上用' });
}

function joined(fake: FakeApi): void {
  fake.control.network.register('you', 'Alex');
}

describe('Use on another device', () => {
  it('with @handle shows consequences, URL, QR code, and copy action', async () => {
    await renderApp({ hash: '#/settings/account', setup: joined });
    const region = await section();
    expect(region.textContent).toContain('登录的人能用这台电脑做事。');
    await within(region).findByText('https://you.cyberhunter.top');
    expect(within(region).getByRole('button', { name: '复制网址' })).toBeTruthy();
    expect(within(region).getByRole('button', { name: '连法' }).textContent).toBe('Cyber Hunter 网络');
    expect(within(region).queryByRole('img', { name: /二维码/ })).toBeNull();
    fireEvent.click(within(region).getByRole('button', { name: '二维码' }));
    expect(within(region).getByRole('img', { name: '二维码：https://you.cyberhunter.top' })).toBeTruthy();
  });

  it('without @handle prompts to claim one and omits QR code', async () => {
    await renderApp({ hash: '#/settings/account' });
    const region = await section();
    await within(region).findByText('起了 @账号就有自己的网址，在上面账号一行起。');
    expect(within(region).queryByRole('img', { name: /二维码/ })).toBeNull();
  });

  it('custom domain rejects http, saves https as default view, and clears on Remove', async () => {
    const app = await renderApp({ hash: '#/settings/account', setup: joined });
    const region = await section();
    fireEvent.click(await within(region).findByRole('button', { name: '连法' }));
    fireEvent.click(await screen.findByRole('menuitemcheckbox', { name: '我自己的网址' }));
    const form = within(region).getByRole('form', { name: '我自己的网址' });
    fireEvent.change(within(form).getByLabelText('网址'), { target: { value: 'http://192.168.1.5:8790' } });
    fireEvent.click(within(form).getByRole('button', { name: '保存' }));
    expect((await within(form).findByRole('alert')).textContent).toContain('https');
    fireEvent.change(within(form).getByLabelText('网址'), { target: { value: 'https://box.example.test/' } });
    fireEvent.click(within(form).getByRole('button', { name: '保存' }));
    await waitFor(() => expect((within(form).getByLabelText('网址') as HTMLInputElement).value)
      .toBe('https://box.example.test'));
    expect((await app.api.account.ownUrl()).ownUrl).toBe('https://box.example.test');
    fireEvent.click(within(form).getByRole('button', { name: '移除' }));
    await waitFor(async () => expect((await app.api.account.ownUrl()).ownUrl).toBeNull());
  });

  it('signed-in devices display how they connected', async () => {
    await renderApp({ hash: '#/settings/account', setup: (fake) => {
      joined(fake);
      fake.control.session.seedDevice('书房的 iPhone', 'direct');
      fake.control.session.seedDevice('公司电脑', 'relay');
    } });
    const pane = await screen.findByRole('dialog', { name: '设置' });
    const devices = await within(pane).findByRole('region', { name: '登录着的设备' });
    const phone = (await within(devices).findByText('书房的 iPhone')).closest('li')!;
    expect(phone.textContent).toContain('直连');
    expect(within(devices).getByText('公司电脑').closest('li')!.textContent).toContain('经中继');
  });
});
