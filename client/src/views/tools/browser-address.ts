import { searchUrl } from '../../shell/search-engine.ts';

export function browserAddress(input: string): string {
  const value = input.trim();
  if (/^https?:\/\//i.test(value)) { return value; }
  if (/^[\w.-]+\.[a-z]{2,}(?::\d+)?(?:[/?#]\S*)?$/i.test(value)
    || /^localhost(?::\d+)?(?:[/?#]\S*)?$/.test(value)) { return `https://${value}`; }
  // 不像网址的当搜索词，用设置 · 浏览器里选的那个搜索引擎（原来这里写死谷歌、网页标签写死必应）。
  return searchUrl(value);
}
