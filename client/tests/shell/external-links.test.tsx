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

describe('external links', () => {
  it('with web-tab bridge, feed links open in Plasticine web tab instead of system browser', async () => {
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

  it('with web-tab bridge, programmatic openExternal opens a Plasticine web tab', async () => {
    install();
    const app = await renderApp();
    await settle();
    openExternal('https://example.com/b', 'B');
    await waitFor(() => expect(app.state.webTabs.get().tabs.some((tab) => tab.url === 'https://example.com/b'))
      .toBe(true));
  });

  it('without bridge, clicks and openExternal open in a new window', async () => {
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

  it('only intercepts external URLs; in-app routes, same-origin attachments, and mailto pass', () => {
    const base = 'https://plasticine.test/app/#/today';
    expect(externalUrl('https://example.com/a?b=1', base)).toBe('https://example.com/a?b=1');
    expect(externalUrl('#/notes/n1', base)).toBeNull();
    expect(externalUrl('/files/shot.png', base)).toBeNull();
    expect(externalUrl('https://plasticine.test/v2/files/x', base)).toBeNull();
    expect(externalUrl('mailto:me@example.com', base)).toBeNull();
  });
});
