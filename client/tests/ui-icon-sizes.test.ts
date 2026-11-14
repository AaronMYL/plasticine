// 11-14 界面统一（Aaron 弹框定「都做成令牌，加自动检查」）：图标只有四档 12 · 14 · 16 · 20（tokens.css 的 --icon-*）。
// 扫客户端源码里 <Icon … size={n}> 和 <IconButton … size={n}> 写的数字，不在这四档里的不过。

import { readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ROOT, sourceFiles } from './source-texts.ts';

const SIZES = [12, 14, 16, 20];
const ICON_SIZE = /<(Icon|IconButton)\b(?:[^<>]|=>)*?size=\{(\d+)\}/gs;

function offenders(source: string): string[] {
  return [...source.matchAll(ICON_SIZE)].filter((match) => !SIZES.includes(Number(match[2])))
    .map((match) => `${match[1]} size=${match[2]}`);
}

describe('图标只有四档', () => {
  it('扫描器认得出写在组件上的大小', () => {
    expect(offenders('<Icon name="clock" size={13} />\n<IconButton icon="more"\n  label="更多" size={16} />'))
      .toEqual(['Icon size=13']);
  });

  it('客户端里的图标都是 12、14、16、20', () => {
    const hits = sourceFiles(join(ROOT, 'client', 'src')).filter((path) => path.endsWith('.tsx'))
      .flatMap((path) => offenders(readFileSync(path, 'utf8')).map((hit) => `${relative(ROOT, path)}：${hit}`));
    expect(hits).toEqual([]);
  });
});
