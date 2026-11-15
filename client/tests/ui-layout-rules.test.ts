// 界面统一第二轮定下的规矩（11-15 Aaron 弹框定，设计稿 17–23；正本是 agent/skills/plasticine-visual/references/page-spec.md）
// 的自动检查：换了谁来写界面，违反了 npm run check 就不过。每条真有例外，在那一行写「例外：原因」。
// 官网（views/site）是另一套，不管。

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SECTIONS } from '../src/shell/sections.ts';

const SRC = join(import.meta.dirname, '..', 'src');

function files(dir: string, ext: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === 'site' ? [] : files(path, ext);
    return name.endsWith(ext) ? [path] : [];
  });
}

/** 每一行（带文件名和行号），跳过写了「例外」的行。 */
function lines(ext: string): { where: string; name: string; text: string; index: number; all: string[] }[] {
  return files(SRC, ext).flatMap((path) => {
    const name = relative(SRC, path).replaceAll('\\', '/');
    const all = readFileSync(path, 'utf8').split('\n');
    return all.map((text, index) => ({ where: `${name}:${index + 1}`, name, text, index, all }))
      .filter((line) => !line.text.includes('例外'));
  });
}

describe('内容区两种宽度（设计稿 22）', () => {
  it('页面内容不写死 680 以上的宽度：读的用 --page-read，管的用 --page-manage', () => {
    const found = lines('.css').filter(({ text }) => {
      const match = /(?:^|[\s;{])(?:max-)?width:\s*(?:min\()?(\d+)px/.exec(text);
      return match !== null && Number(match[1]) >= 680;
    }).map(({ where, text }) => `${where} ${text.trim()}`);
    expect(found).toEqual([]);
  });
});

describe('滚动条一种（设计稿 21）', () => {
  it('滚动条的样子只写在 shell/base.css；别处只能用 scrollbar-width: none / display: none 把横滑的藏起来', () => {
    const found: string[] = [];
    for (const path of files(SRC, '.css')) {
      const name = relative(SRC, path).replaceAll('\\', '/');
      if (name === 'shell/base.css') continue;
      const css = readFileSync(path, 'utf8');
      css.split('\n').forEach((text, index) => {
        if (/scrollbar-color|scrollbar-width:(?!\s*none)/.test(text)) found.push(`${name}:${index + 1} ${text.trim()}`);
      });
      for (const block of css.matchAll(/([^{}]*::-webkit-scrollbar[^{]*)\{([^}]*)\}/g)) {
        if (!/display:\s*none/.test(block[2]!)) found.push(`${name} ${block[1]!.trim()}`);
      }
    }
    expect(found).toEqual([]);
  });
});

describe('加载（设计稿 20 ②）', () => {
  it('按钮做的事在跑时转圈（primitives/busy 的 BusyText），按钮里不再把字换成「正在读…」', () => {
    const found = lines('.tsx').filter(({ text }) => />\s*\{[^}]*\?\s*'正在读…'/.test(text)
      || /^\s*\{[^}]*\?\s*'正在读…'\s*:/.test(text))
      .map(({ where, text }) => `${where} ${text.trim()}`);
    expect(found).toEqual([]);
  });
});

describe('空（设计稿 20 ③）', () => {
  it('空状态一种字：*-empty 和 .block-empty 只用 13/20（--text-ui），不居中', () => {
    const found: string[] = [];
    for (const path of files(SRC, '.css')) {
      const name = relative(SRC, path).replaceAll('\\', '/');
      const css = readFileSync(path, 'utf8');
      for (const block of css.matchAll(/([^{}\n]*-empty[^{}\n]*)\{([^}]*)\}/g)) {
        const selector = block[1]!.trim();
        if (selector.includes('::before') || selector.includes('is-empty')) continue;
        const body = block[2]!;
        const size = /font-size:\s*([^;]+);/.exec(body)?.[1]?.trim();
        if (size !== undefined && size !== 'var(--text-ui)' && size !== 'inherit') {
          found.push(`${name} ${selector} font-size: ${size}`);
        }
        if (/text-align:\s*center|place-items:\s*center/.test(body)) found.push(`${name} ${selector} 居中`);
      }
    }
    expect(found).toEqual([]);
  });
});

describe('动效一套（设计稿 19）', () => {
  it('出现的位移只有 4px：@keyframes 里的 translate 不写别的数（抽屉、提示条这类整块滑入在那一行写例外）', () => {
    const found: string[] = [];
    for (const path of files(SRC, '.css')) {
      const name = relative(SRC, path).replaceAll('\\', '/');
      const css = readFileSync(path, 'utf8');
      for (const frames of css.matchAll(/@keyframes[^{]*\{((?:[^{}]*\{[^}]*\})*)[^{}]*\}/g)) {
        for (const line of frames[0].split('\n')) {
          if (line.includes('例外')) continue;
          for (const move of line.matchAll(/translate[XY]?\((-?\d+)px\)/g)) {
            const px = Math.abs(Number(move[1]));
            if (px !== 0 && px !== 4) found.push(`${name} ${line.trim()}`);
          }
        }
      }
    }
    expect(found).toEqual([]);
  });
});

describe('第二栏标题行（设计稿 23）', () => {
  it('第二栏标题写栏目名本身（不跟着主线、队友改的名字变）', () => {
    const labels = new Set(Object.values(SECTIONS).map((section) => section.label));
    const found = lines('.tsx').flatMap(({ where,
      text }) => [...text.matchAll(/<ColumnHead title=(\{[^}]*\}|"[^"]*")/g)]
      .map((match) => match[1]!).filter((title) => !(title.startsWith('"') && labels.has(title.slice(1, -1))))
      .map((title) => `${where} title=${title}`));
    expect(found).toEqual([]);
  });
});
