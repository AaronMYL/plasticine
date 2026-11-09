// 官网（11-09 设计稿）：协作演示点步骤能跳、功能标签能切且每个都能点出结果、下载卡片的地址只来自发布清单。
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SitePage } from '../../../src/views/site/site-page.tsx';
import { visitorPlatform } from '../../../src/views/site/site-download.tsx';

const VERSION = '2026.1109.171133';
const BASE = `https://github.com/example/plasticine/releases/download/v${VERSION}/`;
const asset = (name: string) => ({ name, url: `${BASE}${name}`, sha256: 'a'.repeat(64), size: 168_923_322 });

function stubFetch(): void {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (url.endsWith('/download/desktop.json')) {
      return new Response(JSON.stringify({ schema: 1, version: VERSION, commit: 'c'.repeat(40),
        publishedAt: '2026-11-09T17:30:00.000Z', assets: { windows: asset(`Plasticine-Desktop-Setup-${VERSION}.exe`),
          macDisk: asset(`Plasticine-Desktop-mac-${VERSION}.dmg`) } }));
    }
    if (url.endsWith('/download/manifest.json')) {
      return new Response(JSON.stringify({ schema: 1, version: VERSION, commit: 'c'.repeat(40),
        publishedAt: '2026-11-09T17:30:00.000Z', nodeVersion: '24.22.1', assets: {
          server: asset(`plasticine-server-${VERSION}.tar.gz`), linuxInstaller: asset('install.sh') } }));
    }
    return new Response('not found', { status: 404 });
  }));
}

afterEach(() => vi.unstubAllGlobals());

describe('官网', () => {
  it('协作演示：点「汇总」直接跳到结果，自动播放停下', async () => {
    stubFetch();
    render(<SitePage />);
    const demo = screen.getByLabelText('协作演示');
    expect(within(demo).getByText('这周六去成都玩两天，帮我和阿杰排个行程。')).toBeTruthy();
    fireEvent.click(within(demo).getByRole('tab', { name: '汇总' }));
    expect(within(demo).getByText('成都 · 周六到周日')).toBeTruthy();
    expect(within(demo).getByRole('button', { name: '自动播放' })).toBeTruthy();
  });

  it('功能：切到图书能提问，切到浏览器能走到归档', async () => {
    stubFetch();
    render(<SitePage />);
    fireEvent.click(screen.getByRole('tab', { name: '图书' }));
    fireEvent.click(screen.getByRole('button', { name: '为什么找不到路了？' }));
    expect(screen.getByText('已记进读书笔记')).toBeTruthy();
    fireEvent.click(screen.getByRole('tab', { name: '浏览器' }));
    fireEvent.click(screen.getByRole('button', { name: '归档' }));
    expect(screen.getByText('已归档，原网页一起存了')).toBeTruthy();
  });

  it('下载：按钮直接指向发布清单里的 GitHub 地址，服务器那张卡给安装命令', async () => {
    stubFetch();
    render(<SitePage />);
    const windows = await screen.findByRole('link', { name: '下载 Windows 版' });
    await waitFor(() => expect(screen.getAllByRole('link', { name: '下载 Mac 版' })[0]?.getAttribute('href'))
      .toBe(`${BASE}Plasticine-Desktop-mac-${VERSION}.dmg`));
    expect(windows).toBeTruthy();
    expect(await screen.findByText(`curl -fsSL '${BASE}install.sh' | sudo sh`)).toBeTruthy();
    expect(screen.getByRole('link', { name: '历史版本' }).getAttribute('href'))
      .toBe('https://github.com/AaronMYL/plasticine/releases');
  });

  it('认系统：手机、Windows、Linux、Mac', () => {
    expect(visitorPlatform('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)')).toBe('phone');
    expect(visitorPlatform('Mozilla/5.0 (Windows NT 10.0; Win64; x64)')).toBe('windows');
    expect(visitorPlatform('Mozilla/5.0 (X11; Linux x86_64)')).toBe('linux');
    expect(visitorPlatform('Mozilla/5.0 (Macintosh; Intel Mac OS X 15_0)')).toBe('mac');
  });
});
