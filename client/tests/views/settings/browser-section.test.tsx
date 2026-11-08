// 设置 · 浏览器（第 3 批，设计稿 Settings-Browser / Import）：「登录着的网站」只在这台 Mac（不进服务器），
// 「导入」从 Chrome 或 Safari 搬一次登录状态（11-05 第 6 条：全部不用钥匙串，不导密码）；Safari 要完全磁盘访问时如实说、
// 给打开系统设置。
// 不是 Mac App（iPhone、网页版）整页一句话。

import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { LoginImportRequest, PlasticineMacLogins } from '../../../src/api/shared.ts';
import { BrowserSection } from '../../../src/views/settings/browser-section.tsx';

interface FakeLogins extends PlasticineMacLogins {
  imported: LoginImportRequest[];
  forgotten: string[];
  fullDiskAccess: number;
}

const IMPORTED = { sites: 120, cookies: 1840, passwords: 0, skipped: 4, problem: null };

function fakeLogins(result: unknown = IMPORTED): FakeLogins {
  const sites = [
    { host: 'x.com', name: 'X', password: true, since: '2026-11-02T12:00:00.000Z' },
    { host: 'github.com', name: 'GitHub', password: false, since: '2026-10-28T12:00:00.000Z' },
    { host: 'console.cloud.tencent.com', name: '腾讯云', password: false, since: null },
  ];
  const fake: FakeLogins = {
    imported: [], forgotten: [], fullDiskAccess: 0,
    sites: () => Promise.resolve({ sites: sites.filter((site) => !fake.forgotten.includes(site.host)) }),
    sources: () => Promise.resolve({ sources: [
      { id: 'chrome', available: true, profile: '默认个人资料', sites: 214, needs: null, passwords: true },
      { id: 'safari', available: true, profile: null, sites: null, needs: 'full_disk_access', passwords: false },
    ] }),
    import: (request) => {
      fake.imported.push(request);
      return Promise.resolve(result);
    },
    forget: (host) => {
      fake.forgotten.push(host);
      return Promise.resolve(true);
    },
    openFullDiskAccess: () => {
      fake.fullDiskAccess += 1;
    },
  };
  window.plasticineDesktop = { version: '0.6.0', notify: () => undefined, logins: fake };
  return fake;
}

afterEach(() => {
  delete window.plasticineDesktop;
  vi.restoreAllMocks();
});

describe('设置 · 浏览器', () => {
  it('不是 Mac App：整页一句话，说登录只在 Mac 上', () => {
    render(<BrowserSection />);
    expect(screen.getByText(/登录只记在 Mac 上 Plasticine 的浏览器里/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: '导入…' })).toBeNull();
  });

  it('列出登录着的网站：名字、域名、登录的日子；「只在这台 Mac」的说明进浮框', async () => {
    fakeLogins();
    render(<BrowserSection />);
    const list = await screen.findByRole('list', { name: '登录着的网站' });
    const rows = within(list).getAllByRole('listitem');
    expect(rows.map((row) => row.textContent)).toEqual([
      expect.stringContaining('x.com'), expect.stringContaining('github.com'),
      expect.stringContaining('console.cloud.tencent.com')]);
    expect(rows[0]!.textContent).toContain('11-02');
    expect(screen.getByText('只在这台 Mac')).toBeTruthy();
    const lock = screen.getByRole('button', { name: '登录只存在这台 Mac 上，不进服务器' });
    expect(lock.getAttribute('data-tip')).toBe('登录只存在这台 Mac 上，不进服务器');
  });

  it('⋯ 里退出一个网站：删掉它的登录，列表跟着少一行', async () => {
    const fake = fakeLogins();
    render(<BrowserSection />);
    await screen.findByRole('list', { name: '登录着的网站' });
    fireEvent.click(screen.getByRole('button', { name: '「GitHub」的更多操作' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: '退出这个网站' }));
    await waitFor(() => expect(fake.forgotten).toEqual(['github.com']));
    await waitFor(() => expect(screen.queryByText('github.com')).toBeNull());
  });

  it('导入：Chrome 默认选中、写着个人资料和网站数，没有导密码的选项；导完说搬了多少', async () => {
    const fake = fakeLogins();
    render(<BrowserSection />);
    fireEvent.click(await screen.findByRole('button', { name: '导入…' }));
    const sheet = await screen.findByRole('dialog', { name: '导入登录' });
    const chrome = within(sheet).getByRole('radio', { name: /Chrome/ }) as HTMLInputElement;
    expect(chrome.checked).toBe(true);
    expect(sheet.textContent).toContain('默认个人资料 · 214 个网站');
    expect(sheet.textContent).toContain('要你在系统设置里给一次「完全磁盘访问」');
    expect(within(sheet).queryByRole('checkbox')).toBeNull();
    expect(sheet.textContent).not.toContain('密码');
    fireEvent.click(within(sheet).getByRole('button', { name: '导入' }));
    // 旧 App（0.6.0 及以前）报 Chrome 能导密码，网页也只发 passwords: false。
    await waitFor(() => expect(fake.imported).toEqual([{ from: 'chrome', passwords: false }]));
    expect(await screen.findByRole('status')).toHaveProperty('textContent',
      '搬过来 120 个网站的登录；4 条过期或解不开的没搬');
  });

  it('Safari：没给完全磁盘访问时如实说，并能打开系统设置', async () => {
    const fake = fakeLogins({ sites: 0, cookies: 0, passwords: 0, skipped: 0,
      problem: '读不到 Safari 的 Cookie：要在系统设置里给 Plasticine「完全磁盘访问」。' });
    render(<BrowserSection />);
    fireEvent.click(await screen.findByRole('button', { name: '导入…' }));
    const sheet = await screen.findByRole('dialog', { name: '导入登录' });
    fireEvent.click(within(sheet).getByRole('radio', { name: /Safari/ }));
    fireEvent.click(within(sheet).getByRole('button', { name: '导入' }));
    await waitFor(() => expect(fake.imported).toEqual([{ from: 'safari', passwords: false }]));
    expect((await screen.findByRole('alert')).textContent).toContain('完全磁盘访问');
    fireEvent.click(within(sheet).getByRole('button', { name: '打开系统设置' }));
    expect(fake.fullDiskAccess).toBe(1);
  });
});
