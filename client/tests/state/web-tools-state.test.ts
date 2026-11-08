// 网页缩放按网站记住、网页历史记录（2026-11-04 第 2 批 ⋯ 菜单）：都在网页侧记，存在这台设备上。

import { describe, expect, it } from 'vitest';
import { HISTORY_MAX, HISTORY_STORAGE_KEY, WebHistory } from '../../src/state/tabs-history.ts';
import { siteOf, SiteZoom, ZOOM_STORAGE_KEY, zoomStep } from '../../src/state/tabs-zoom.ts';
import { memoryStorage } from '../helpers.tsx';

describe('网页缩放按网站记住', () => {
  it('一档一档走，到头停住', () => {
    expect(zoomStep(1, 1)).toBe(1.1);
    expect(zoomStep(1, -1)).toBe(0.9);
    expect(zoomStep(3, 1)).toBe(3);
    expect(zoomStep(0.5, -1)).toBe(0.5);
  });

  it('同一个网站（不管 www. 和路径）记一档；100% 不记；重开还在', () => {
    const storage = memoryStorage();
    const zoom = new SiteZoom(storage);
    zoom.set('https://www.example.com/a', 1.25);
    expect(zoom.of('https://example.com/b?c=1')).toBe(1.25);
    expect(zoom.of('https://other.org/')).toBe(1);
    zoom.set('https://other.org/', 1);
    expect(JSON.parse(storage.data.get(ZOOM_STORAGE_KEY) ?? '{}')).toEqual({ 'example.com': 1.25 });
    expect(new SiteZoom(storage).of('https://example.com/')).toBe(1.25);
    zoom.set('https://example.com/', 1);
    expect(new SiteZoom(storage).of('https://example.com/')).toBe(1);
  });

  it('不是网页的地址不按网站记', () => {
    expect(siteOf('about:blank')).toBeNull();
  });
});

describe('网页历史记录', () => {
  it('新的在前；连着同一个网址只算一条（后来的标题补上）；about:blank 不记；存下来重开还在', () => {
    const storage = memoryStorage();
    const history = new WebHistory(storage);
    history.record({ url: 'https://a.com/', title: '', at: '2026-11-04T08:00:00.000Z' });
    history.record({ url: 'https://a.com/', title: 'A 站', at: '2026-11-04T08:00:01.000Z' });
    history.record({ url: 'about:blank', title: '', at: '2026-11-04T08:00:02.000Z' });
    history.record({ url: 'https://b.com/x', title: 'B 文章', at: '2026-11-04T08:01:00.000Z' });
    history.record({ url: 'https://a.com/', title: 'A 站', at: '2026-11-04T08:02:00.000Z' });
    expect(history.store.get().map((visit) => visit.title)).toEqual(['A 站', 'B 文章', 'A 站']);
    expect(history.search('', 10).map((visit) => visit.url)).toEqual(['https://a.com/', 'https://b.com/x']);
    expect(history.search('文章', 10).map((visit) => visit.url)).toEqual(['https://b.com/x']);
    expect(new WebHistory(storage).store.get()).toHaveLength(3);
    expect(storage.data.has(HISTORY_STORAGE_KEY)).toBe(true);
  });

  it('最多记 500 条，早的先丢', () => {
    const history = new WebHistory(null);
    for (let index = 0; index < HISTORY_MAX + 5; index += 1) {
      history.record({ url: `https://a.com/${index}`, title: `${index}`, at: '2026-11-04T08:00:00.000Z' });
    }
    expect(history.store.get()).toHaveLength(HISTORY_MAX);
    expect(history.store.get().at(-1)?.title).toBe('5');
  });
});
