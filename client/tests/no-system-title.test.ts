// 悬停提示用 Plasticine 自己画的（tooltip.tsx 的 data-tip），不用系统 title（11-04 定，11-14 界面统一清掉最后 27 处）：
// 系统提示样式不归我们管、出得慢，还会和自己的提示叠两层。整行不挂提示，截断的字该换行就换行。
// 这里扫 JSX 里的 HTML 元素，属性里不许有 title=（组件自己的 title 属性不算，比如 PageHeader、ConfirmDialog）。

import { readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import { sourceFiles } from './source-texts.ts';

const SRC = join(import.meta.dirname, '..', 'src');
const TAGS = new Set(('a abbr article button code dd details div dl dt em figcaption figure footer h1 h2 h3 h4 h5 h6 '
  + 'header i img input label li mark nav ol option p pre section select small span strong summary svg table td '
  + 'textarea th time tr ul').split(' '));

/** 一个 HTML 元素开头标签里、最外层（不在 {…} 里）的属性文字。 */
function openingAttributes(text: string, start: number): string {
  let depth = 0;
  let quote: string | null = null;
  let top = '';
  for (let at = start; at < text.length; at += 1) {
    const char = text[at] ?? '';
    if (quote !== null) {
      if (char === '\\') at += 1;
      else if (char === quote) quote = null;
      continue;
    }
    if (char === '"' || ((char === "'" || char === '`') && depth > 0)) quote = char;
    else if (char === '{') depth += 1;
    else if (char === '}') depth -= 1;
    else if (char === '>' && depth === 0) return top;
    else if (depth === 0) top += char;
  }
  return top;
}

describe('不用系统提示', () => {
  it('JSX 里的 HTML 元素没有 title 属性', () => {
    const found = sourceFiles(SRC).filter((path) => path.endsWith('.tsx')).flatMap((path) => {
      const text = readFileSync(path, 'utf8');
      return [...text.matchAll(/<([a-z][a-z0-9]*)(?=[\s>/])/g)].flatMap((match) => {
        if (!TAGS.has(match[1] ?? '')) return [];
        const attributes = openingAttributes(text, (match.index ?? 0) + match[0].length);
        if (!/(^|\s)title=/.test(attributes)) return [];
        const line = text.slice(0, match.index).split('\n').length;
        return [`${relative(SRC, path).replaceAll('\\', '/')}:${line} <${match[1]}>`];
      });
    });
    expect(found).toEqual([]);
  });
});
