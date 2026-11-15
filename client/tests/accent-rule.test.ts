// 强调色只表示「等你」，只做点和描边（11-14 界面统一）：样式里不拿强调色写字。官网（views/site）是另一套配色，不管。

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC = join(import.meta.dirname, '..', 'src');
/** 只染图标、不写字的：桌面客户端图标栏的「有新版」更新按钮（11-12 设计稿）。 */
const ICON_ONLY = new Set(['shell/rail.css']);

function cssFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === 'site' ? [] : cssFiles(path);
    return name.endsWith('.css') ? [path] : [];
  });
}

describe('强调色不写字', () => {
  it('客户端样式里没有 color: var(--accent)', () => {
    const found = cssFiles(SRC).flatMap((path) => {
      const name = relative(SRC, path).replaceAll('\\', '/');
      if (ICON_ONLY.has(name)) return [];
      return readFileSync(path, 'utf8').split('\n').flatMap((line, index) =>
        /(^|[\s;{])color:\s*var\(--accent\)/.test(line) ? [`${name}:${index + 1} ${line.trim()}`] : []);
    });
    expect(found).toEqual([]);
  });
});
