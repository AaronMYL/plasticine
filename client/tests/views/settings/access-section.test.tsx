// 设置 · 账号 ·「在别的设备上用」（11-12《首次使用解耦》）：常显后果一句；Cyber Hunter 网络给网址、二维码、复制；
// 没 @账号说一句去起；我自己的网址只收 https，存了以后再进来默认停在这一边，「不用了」清掉；设备列表写怎么连进来的。

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

describe('在别的设备上用', () => {
  it('有 @账号：常显后果，给网址、二维码和复制', async () => {
    await renderApp({ hash: '#/settings/account', setup: joined });
    const region = await section();
    expect(region.textContent).toContain('登录的人能用这台电脑做事。');
    await within(region).findByText('https://you.cyberhunter.top');
    expect(within(region).getByRole('img', { name: '二维码：https://you.cyberhunter.top' })).toBeTruthy();
    expect(within(region).getByRole('button', { name: '复制网址' })).toBeTruthy();
    expect(within(region).getByRole('button', { name: 'Cyber Hunter 网络' }).getAttribute('aria-pressed'))
      .toBe('true');
  });

  it('没 @账号：说一句去起，不给二维码', async () => {
    await renderApp({ hash: '#/settings/account' });
    const region = await section();
    await within(region).findByText('起了 @账号就有自己的网址，在上面账号一行起。');
    expect(within(region).queryByRole('img', { name: /二维码/ })).toBeNull();
  });

  it('自己的网址：http 不收；https 存下，再进来默认这一边；「不用了」清掉', async () => {
    const app = await renderApp({ hash: '#/settings/account', setup: joined });
    const region = await section();
    fireEvent.click(await within(region).findByRole('button', { name: '我自己的网址' }));
    const form = within(region).getByRole('form', { name: '我自己的网址' });
    fireEvent.change(within(form).getByLabelText('网址'), { target: { value: 'http://192.168.1.5:8790' } });
    fireEvent.click(within(form).getByRole('button', { name: '保存' }));
    expect((await within(form).findByRole('alert')).textContent).toContain('https');
    fireEvent.change(within(form).getByLabelText('网址'), { target: { value: 'https://box.example.test/' } });
    fireEvent.click(within(form).getByRole('button', { name: '保存' }));
    await waitFor(() => expect((within(form).getByLabelText('网址') as HTMLInputElement).value)
      .toBe('https://box.example.test'));
    expect((await app.api.account.ownUrl()).ownUrl).toBe('https://box.example.test');
    fireEvent.click(within(form).getByRole('button', { name: '不用了' }));
    await waitFor(async () => expect((await app.api.account.ownUrl()).ownUrl).toBeNull());
  });

  it('登录着的设备写怎么连进来的', async () => {
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
