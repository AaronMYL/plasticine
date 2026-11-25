import { afterEach, describe, expect, it } from 'vitest';
import { readSearchEngine, saveSearchEngine, searchUrl } from '../../src/shell/search-engine.ts';
import { addressToUrl } from '../../src/shell/use-native-web-tabs.ts';
import { addressSuggestions } from '../../src/shell/web-address-field.tsx';
import { browserAddress } from '../../src/views/tools/browser-address.ts';

const BOOKMARKS = [
  { title: '示例文档', target: 'https://docs.example.com/guide' },
  { title: '首页', target: '#/today' },
  { title: '分组', target: null },
];
const VISITS = [
  { title: '示例文档 · 安装', url: 'https://docs.example.com/install' },
  { title: '示例文档', url: 'https://docs.example.com/guide' },
  { title: '天气', url: 'https://weather.example.org/' },
];

afterEach(() => localStorage.clear());

describe('address bar suggestions', () => {
  it('hidden when empty; lists matching bookmarks then history deduped by URL, search last', () => {
    expect(addressSuggestions('  ', BOOKMARKS, VISITS)).toEqual([]);
    const found = addressSuggestions('示例', BOOKMARKS, VISITS);
    expect(found.map((item) => [item.kind, item.url])).toEqual([
      ['bookmark', 'https://docs.example.com/guide'],
      ['history', 'https://docs.example.com/install'],
      ['go', `https://www.bing.com/search?q=${encodeURIComponent('示例')}`],
    ]);
    expect(found.at(-1)?.title).toBe('用必应搜「示例」');
  });

  it('URL input offers open-URL last and excludes internal app bookmarks', () => {
    const found = addressSuggestions('weather.example.org', BOOKMARKS, VISITS);
    expect(found.map((item) => item.kind)).toEqual(['history', 'go']);
    expect(found.at(-1)).toEqual({ kind: 'go', title: '打开 weather.example.org', url: 'https://weather.example.org' });
    expect(addressSuggestions('today', BOOKMARKS, []).map((item) => item.kind)).toEqual(['go']);
  });

  it('caps suggestions at 6 items', () => {
    const many = Array.from({ length: 20 }, (_, index) => ({ title: `示例 ${index}`,
      url: `https://example.com/${index}` }));
    expect(addressSuggestions('示例', [], many)).toHaveLength(6);
  });
});

describe('search engine setting', () => {
  it('defaults to Bing; changing in settings updates web tabs and legacy browser page', () => {
    expect(readSearchEngine()).toBe('bing');
    expect(addressToUrl('杭州 天气')).toBe(`https://www.bing.com/search?q=${encodeURIComponent('杭州 天气')}`);
    saveSearchEngine('baidu');
    expect(addressToUrl('杭州 天气')).toBe(`https://www.baidu.com/s?wd=${encodeURIComponent('杭州 天气')}`);
    expect(browserAddress('杭州 天气')).toBe(searchUrl('杭州 天气', 'baidu'));
    expect(addressSuggestions('杭州', [], []).at(-1)?.title).toBe('用百度搜「杭州」');
    localStorage.setItem('plasticine.search-engine', 'nonsense');
    expect(readSearchEngine()).toBe('bing');
  });

  it('URL-like input is not sent to search engine', () => {
    expect(browserAddress('example.com/a')).toBe('https://example.com/a');
    expect(addressToUrl('https://example.com')).toBe('https://example.com');
  });
});
