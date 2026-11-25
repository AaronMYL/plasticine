import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SitePage } from '../../../src/views/site/site-page.tsx';
import { SCENES as PLAYED } from '../../../src/demo/scenes.ts';
import { visitorPlatform } from '../../../src/views/site/site-download.tsx';
import { cipherAt, SCENES } from '../../../src/views/site/site-stage.tsx';

vi.mock('../../../src/shell/ambient/engine.ts', () => ({
  AmbientEngine: class {
    setQuiet(): void {  }

    destroy(): void {  }
  },
}));

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

describe('Website', () => {
  it('stage embeds demo page, switches scenes on click, and syncs tab from demo scene events', () => {
    stubFetch();
    render(<SitePage />);
    const frame = screen.getByTitle<HTMLIFrameElement>('Plasticine 的界面，正在自动演示');
    expect(frame.getAttribute('src')).toBe('/demo.html');
    const post = vi.spyOn(frame.contentWindow!, 'postMessage').mockImplementation(() => undefined);
    fireEvent.load(frame);
    const tabs = within(screen.getByRole('tablist', { name: '演示到哪一幕' }));
    expect(tabs.getAllByRole('tab').map((tab) => tab.getAttribute('aria-selected')))
      .toEqual(['true', 'false', 'false', 'false', 'false']);
    expect(post).toHaveBeenCalledWith({ plasticineDemo: 'run', on: true }, window.location.origin);
    fireEvent.click(tabs.getByRole('tab', { name: '笔记续写和建议' }));
    expect(post).toHaveBeenCalledWith({ plasticineDemo: 'go', id: 'notes' }, window.location.origin);
    expect(tabs.getByRole('tab', { name: '笔记续写和建议' }).getAttribute('aria-selected')).toBe('true');
    act(() => {
      window.dispatchEvent(new MessageEvent('message', { source: frame.contentWindow,
        data: { plasticineDemo: 'scene', id: 'dev' } }));
    });
    expect(tabs.getByRole('tab', { name: '软件开发：队友接力' }).getAttribute('aria-selected')).toBe('true');
  });

  it('ignores postMessage events from other windows', () => {
    stubFetch();
    render(<SitePage />);
    act(() => {
      window.dispatchEvent(new MessageEvent('message', { source: window,
        data: { plasticineDemo: 'scene', id: 'dev' } }));
    });
    expect(screen.getByRole('tab', { name: '读信息流和来信' }).getAttribute('aria-selected')).toBe('true');
  });

  it('stage scenes match demo page script 1-to-1', () => {
    expect(SCENES.map((scene) => scene.id)).toEqual(PLAYED.map((scene) => scene.id));
  });

  it('explains mobile direct connect, encryption scope, and FAQ without 5-step onboarding', () => {
    stubFetch();
    render(<SitePage />);
    expect(screen.getByRole('heading', { name: '手机网页直连你的电脑' })).toBeTruthy();
    expect(screen.getByRole('img', { name: '手机浏览器直连你的电脑；直连不上时经中继转发，仍是加密的连接' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: '端到端加密保护什么' })).toBeTruthy();
    expect(screen.getByText('中继看得到的')).toBeTruthy();
    expect(screen.getByText('不在范围里的')).toBeTruthy();
    expect(screen.getByRole('heading', { name: '常见问题' })).toBeTruthy();
    expect(screen.getByText('要自己准备模型吗？')).toBeTruthy();
    expect(screen.queryByText('上手')).toBeNull();
  });

  it('relay ciphertext mutates every beat and never exposes plaintext', () => {
    expect(cipherAt(1)).not.toBe(cipherAt(2));
    expect(cipherAt(3)).toMatch(/^[A-Za-z0-9·]+$/u);
  });

  it('download button points to manifest GitHub URL and server card shows install command', async () => {
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

  it('detects OS: mobile, Windows, Linux, and Mac', () => {
    expect(visitorPlatform('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)')).toBe('phone');
    expect(visitorPlatform('Mozilla/5.0 (Windows NT 10.0; Win64; x64)')).toBe('windows');
    expect(visitorPlatform('Mozilla/5.0 (X11; Linux x86_64)')).toBe('linux');
    expect(visitorPlatform('Mozilla/5.0 (Macintosh; Intel Mac OS X 15_0)')).toBe('mac');
  });
});
