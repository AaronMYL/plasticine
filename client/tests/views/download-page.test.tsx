import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DownloadPage, platformOf } from '../../src/views/download/download-page.tsx';
import { parseDesktopCatalog, parseLinuxCommand, shortVersion } from '../../src/views/download/release-catalog.ts';
import { desktopFixture, releaseFixture } from './download-fixture.ts';

const BASE = 'https://cyberhunter.top';
const MAC = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/605.1.15 Safari/605.1.15';
const WINDOWS = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/130';
const LINUX = 'Mozilla/5.0 (X11; Linux x86_64) Chrome/130';
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Mobile/15E148';

function respond(url: string): Response {
  if (url.endsWith('/download/desktop.json')) return new Response(JSON.stringify(desktopFixture()));
  if (url.endsWith('/download/manifest.json')) return new Response(JSON.stringify(releaseFixture()));
  return new Response('', { status: 404 });
}

function page(agent: string, fetcher = vi.fn(async (input: RequestInfo | URL) => respond(String(input))),
  navigate = vi.fn()) {
  render(<DownloadPage fetcher={fetcher as unknown as typeof fetch} base={BASE} navigate={navigate} agent={agent} />);
  return { fetcher, navigate };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('download page', () => {
  it('Mac primary downloads dmg with version; secondary shows Windows, server install, sign-in', async () => {
    page(MAC);
    const button = await screen.findByRole('link', { name: '下载 Mac 版' });
    expect(button.getAttribute('href')).toBe(`${BASE}/download/2026.1108.120000/Plasticine.dmg`);
    expect(screen.getByText('Apple 芯片和 Intel 都能用 · 2026.1108')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Windows' }).getAttribute('href')).toContain('Plasticine-Setup.exe');
    expect(screen.getByRole('button', { name: '装在服务器上（Linux）' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '已经有 Plasticine？去登录' })).toBeTruthy();
    expect(screen.queryByText(/配对/)).toBeNull();
  });

  it('Windows primary downloads installer with Mac secondary option', async () => {
    page(WINDOWS);
    const button = await screen.findByRole('link', { name: '下载 Windows 版' });
    expect(button.getAttribute('href')).toContain('Plasticine-Setup.exe');
    expect(screen.getByRole('link', { name: 'Mac' }).getAttribute('href')).toContain('Plasticine.dmg');
  });

  it('server install fetches script and displays copyable command', async () => {
    const writeText = vi.fn(async () => undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    page(MAC);
    fireEvent.click(await screen.findByRole('button', { name: '装在服务器上（Linux）' }));
    const command = await screen.findByText(/curl -fsSL/);
    expect(command.textContent).toBe(`curl -fsSL '${BASE}/download/2026.1106.120000/install.sh' | sudo sh`);
    fireEvent.click(screen.getByRole('button', { name: '复制' }));
    await screen.findByRole('button', { name: '复制好了' });
    expect(writeText).toHaveBeenCalledWith(command.textContent);
  });

  it('Linux desktop opens with server install command expanded', async () => {
    page(LINUX);
    expect(await screen.findByText(/curl -fsSL/)).toBeTruthy();
    expect(screen.queryByRole('link', { name: /下载 .* 版/ })).toBeNull();
  });

  it('sign-in jumps to handle login page or shows inline error when unrecognized', async () => {
    const { navigate } = page(MAC);
    fireEvent.click(await screen.findByRole('button', { name: '已经有 Plasticine？去登录' }));
    const input = screen.getByLabelText('@账号或地址');
    fireEvent.change(input, { target: { value: 'https://user:pw@x.test' } });
    fireEvent.click(screen.getByRole('button', { name: '去登录' }));
    expect(screen.getByRole('alert').textContent).toContain('认不出');
    fireEvent.change(input, { target: { value: '@alex_li' } });
    fireEvent.submit(input.closest('form')!);
    expect(navigate).toHaveBeenCalledWith('https://alex-li.cyberhunter.top/#/login');
  });

  it('manifest fetch failure avoids fake URLs and offers retry that reveals download button', async () => {
    let fail = true;
    const fetcher = vi.fn(async (input: RequestInfo | URL) => (fail ? new Response('', { status: 503 })
      : respond(String(input))));
    page(MAC, fetcher);
    expect((await screen.findByRole('alert')).textContent).toContain('没读到安装包');
    expect(screen.queryByRole('link', { name: '下载 Mac 版' })).toBeNull();
    fail = false;
    fireEvent.click(screen.getByRole('button', { name: '再读一次' }));
    expect(await screen.findByRole('link', { name: '下载 Mac 版' })).toBeTruthy();
  });

  it('mobile prompts desktop setup first, expands handle sign-in, skips desktop manifest fetch', async () => {
    const { fetcher, navigate } = page(IPHONE);
    expect(screen.getByText(/先在电脑上装好/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '已经有了，去登录' }));
    fireEvent.change(screen.getByLabelText('@账号或地址'), { target: { value: 'you' } });
    fireEvent.click(screen.getByRole('button', { name: '去登录' }));
    expect(navigate).toHaveBeenCalledWith('https://you.cyberhunter.top/#/login');
    await waitFor(() => expect(fetcher).not.toHaveBeenCalled());
  });

  it('manifest validator requires https without creds, prefers dmg over zip, trims version', () => {
    const url = `${BASE}/download/desktop.json`;
    expect(parseDesktopCatalog(JSON.stringify(desktopFixture()), url).mac?.name).toBe('Plasticine.dmg');
    const zipOnly = desktopFixture();
    delete zipOnly.assets.macDisk;
    expect(parseDesktopCatalog(JSON.stringify(zipOnly), url).mac?.name).toBe('Plasticine-mac.zip');
    const bad = desktopFixture();
    bad.assets.windows = { ...bad.assets.windows!, url: 'http://evil.test/x.exe' };
    expect(() => parseDesktopCatalog(JSON.stringify(bad), url)).toThrow('下载地址格式不对');
    const sneaky = releaseFixture();
    sneaky.assets.linuxInstaller = { ...sneaky.assets.linuxInstaller!, url: 'https://u:p@x.test/install.sh' };
    expect(() => parseLinuxCommand(JSON.stringify(sneaky), `${BASE}/download/manifest.json`)).toThrow();
    expect(shortVersion('2026.1108.120000')).toBe('2026.1108');
    expect(platformOf(IPHONE)).toBe('phone');
    expect(platformOf(LINUX)).toBe('linux');
  });
});
