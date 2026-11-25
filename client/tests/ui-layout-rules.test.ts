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

function lines(ext: string): { where: string; name: string; text: string; index: number; all: string[] }[] {
  return files(SRC, ext).flatMap((path) => {
    const name = relative(SRC, path).replaceAll('\\', '/');
    const all = readFileSync(path, 'utf8').split('\n');
    return all.map((text, index) => ({ where: `${name}:${index + 1}`, name, text, index, all }))
      .filter((line) => !line.text.includes('allow-exception:'));
  });
}

describe('page content width tokens', () => {
  it('forbids hardcoded widths >= 680px outside --page-read and --page-manage', () => {
    const found = lines('.css').filter(({ text }) => {
      const match = /(?:^|[\s;{])(?:max-)?width:\s*(?:min\()?(\d+)px/.exec(text);
      return match !== null && Number(match[1]) >= 680;
    }).map(({ where, text }) => `${where} ${text.trim()}`);
    expect(found).toEqual([]);
  });
});

describe('unified scrollbar styling', () => {
  it('restricts custom scrollbar rules to shell/base.css apart from hiding horizontal scrollbars', () => {
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

describe('button loading indicator', () => {
  it('uses BusyText spinner instead of swapping button label text to loading copy', () => {
    const found = lines('.tsx').filter(({ text }) => />\s*\{[^}]*\?\s*'正在读…'/.test(text)
      || /^\s*\{[^}]*\?\s*'正在读…'\s*:/.test(text))
      .map(({ where, text }) => `${where} ${text.trim()}`);
    expect(found).toEqual([]);
  });
});

describe('empty state typography', () => {
  it('uses --text-ui left-aligned typography on *-empty and .block-empty selectors', () => {
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
        if (/text-align:\s*center|place-items:\s*center/.test(body)) found.push(`${name} ${selector} centered`);
      }
    }
    expect(found).toEqual([]);
  });
});

describe('entrance motion offset', () => {
  it('restricts @keyframes translate offsets to 0px or 4px unless exempted', () => {
    const found: string[] = [];
    for (const path of files(SRC, '.css')) {
      const name = relative(SRC, path).replaceAll('\\', '/');
      const css = readFileSync(path, 'utf8');
      for (const frames of css.matchAll(/@keyframes[^{]*\{((?:[^{}]*\{[^}]*\})*)[^{}]*\}/g)) {
        for (const line of frames[0].split('\n')) {
          if (line.includes('allow-exception:')) continue;
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

describe('secondary column header title', () => {
  it('uses canonical section labels in ColumnHead title props', () => {
    const labels = new Set(Object.values(SECTIONS).map((section) => section.label));
    const found = lines('.tsx').flatMap(({ where,
      text }) => [...text.matchAll(/<ColumnHead title=(\{[^}]*\}|"[^"]*")/g)]
      .map((match) => match[1]!).filter((title) => !(title.startsWith('"') && labels.has(title.slice(1, -1))))
      .map((title) => `${where} title=${title}`));
    expect(found).toEqual([]);
  });
});
