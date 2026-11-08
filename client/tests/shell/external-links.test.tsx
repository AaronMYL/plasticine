// 站外链接（2026-11-03）：Mac App 有网页标签桥时，全站的站外链接点了都开成 Plasticine 的网页标签（一处统一的拦截，
// open-external.ts）；没有桥时保持现状（浏览器自己开新窗口）。站内地址、mailto: 不拦。

import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PlasticineMacWebTabs } from '../../src/api/shared.ts';
import { externalUrl, openExternal } from '../../src/shell/open-external.ts';
import { renderApp, settle } from '../helpers.tsx';

const ARTICLE = 'https://example.com/article';

function install(): void {
  const bridge: PlasticineMacWebTabs = {
    sync: vi.fn(),
    command: vi.fn(),
    navigate: vi.fn(),
    snapshot: vi.fn(() => Promise.reject(new Error('读不到'))),
  };
  window.plasticineDesktop = { version: '0.2.1', notify: vi.fn(), webTabs: bridge };
}

afterEach(() => {
  delete window.plasticineDesktop;
  vi.restoreAllMocks();
});

async function feedLink(): Promise<HTMLElement> {
  return within(screen.getByRole('main')).findByRole('link', { name: '打开原文' });
}

describe('站外链接', () => {
  it('有网页标签桥：信息流的链接点了开成 Plasticine 的网页标签，不交给系统浏览器', async () => {
    install();
    const app = await renderApp({ hash: '#/feed', setup: (fake) => {
      fake.control.feed.seedItem({ id: 'f_1', title: '一篇文章', url: ARTICLE });
    } });
    const link = await feedLink();
    const opened = vi.spyOn(window, 'open');
    expect(fireEvent.click(link)).toBe(false);
    await waitFor(() => expect(app.state.webTabs.get().tabs.some((tab) => tab.url === ARTICLE))
      .toBe(true));
    expect(window.location.hash.startsWith('#/web/')).toBe(true);
    expect(opened).not.toHaveBeenCalled();
  });

  it('有网页标签桥：代码里打开网址（openExternal）也开成网页标签', async () => {
    install();
    const app = await renderApp();
    await settle();
    openExternal('https://example.com/b', 'B');
    await waitFor(() => expect(app.state.webTabs.get().tabs.some((tab) => tab.url === 'https://example.com/b'))
      .toBe(true));
  });

  it('没有桥（网页版、旧 App）：点了不拦，照旧新窗口；代码里打开也是新窗口', async () => {
    const app = await renderApp({ hash: '#/feed', setup: (fake) => {
      fake.control.feed.seedItem({ id: 'f_1', title: '一篇文章', url: ARTICLE });
    } });
    const link = await feedLink();
    expect(link.getAttribute('target')).toBe('_blank');
    expect(fireEvent.click(link)).toBe(true);
    expect(app.state.webTabs.get().tabs).toHaveLength(0);
    const opened = vi.spyOn(window, 'open').mockReturnValue(null);
    openExternal(ARTICLE, '一篇文章');
    expect(opened).toHaveBeenCalledWith(ARTICLE, '_blank', 'noopener,noreferrer');
  });

  it('站外才拦：站内地址、同源附件、mailto: 不算站外', () => {
    const base = 'https://plasticine.test/app/#/today';
    expect(externalUrl('https://example.com/a?b=1', base)).toBe('https://example.com/a?b=1');
    expect(externalUrl('#/notes/n1', base)).toBeNull();
    expect(externalUrl('/files/shot.png', base)).toBeNull();
    expect(externalUrl('https://plasticine.test/v2/files/x', base)).toBeNull();
    expect(externalUrl('mailto:me@example.com', base)).toBeNull();
  });
});
