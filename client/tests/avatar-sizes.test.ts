// 头像三档（11-14 界面统一设计稿「头像：三档」）：20 行里、提到人的地方；28 列表、对话、信息流的来源；40 资料页、详情的页头。
// 例外各有出处：图标栏 24、手机底栏 26 跟图标一样大（11-14 图标栏设计稿）；对话圆球和编辑里的大预览 52。

import { readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import { sourceFiles } from './source-texts.ts';

const SRC = join(import.meta.dirname, '..', 'src');
const STEPS = new Set([20, 28, 40]);
const EXCEPTIONS: Readonly<Record<string, readonly number[]>> = {
  'shell/rail.tsx': [24],
  'shell/phone-bar.tsx': [26],
  'views/mates/mate-editor.tsx': [52],
  'views/mates/main-identity.tsx': [52],
};

describe('头像三档', () => {
  it('写死的头像大小只有 20、28、40（例外见上）', () => {
    const found = sourceFiles(SRC).filter((path) => path.endsWith('.tsx')).flatMap((path) => {
      const name = relative(SRC, path).replaceAll('\\', '/');
      const allowed = EXCEPTIONS[name] ?? [];
      const text = readFileSync(path, 'utf8');
      return [...text.matchAll(/<\w*Avatar\b[^>]*?\bsize=\{(\d+)\}/g)].flatMap((match) => {
        const size = Number(match[1]);
        if (STEPS.has(size) || allowed.includes(size)) return [];
        return [`${name}:${text.slice(0, match.index).split('\n').length} ${size}`];
      });
    });
    expect(found).toEqual([]);
  });
});
