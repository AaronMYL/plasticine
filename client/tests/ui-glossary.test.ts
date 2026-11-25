import { readFileSync } from 'node:fs';
import { relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import { HOLE, ROOT, SCANNED, sourceFiles, uiTexts } from './source-texts.ts';

const GLOSSARY: readonly { pattern: RegExp; use: string }[] = [
  { pattern: /关闭/u, use: '关掉' },
  { pattern: /删掉/u, use: '删除（从一组里拿掉用移除）' },
  { pattern: /彻底删除/u, use: '永久删除' },
  { pattern: /算了|不用了/u, use: '取消' },
  { pattern: /再试一次/u, use: '重试' },
  { pattern: new RegExp(`选了\\s*(\\d|${HOLE}|$)`, 'u'), use: '已选 n' },
  { pattern: /正在读取/u, use: '正在读' },
  { pattern: /正在存(?!进)/u, use: '正在保存' },
  { pattern: /未能读取|读不出来|读取失败/u, use: '没读到' },
  { pattern: /进行中/u, use: '在做' },
];

const NOT_UI = [/[\\/]mac[\\/]page-operate\.ts$/];

function offenders(text: string): string[] {
  return GLOSSARY.filter((rule) => rule.pattern.test(text)).map((rule) => rule.use);
}

describe('UI glossary check', () => {
  it('detects disallowed glossary terms while ignoring comments', () => {
    const sample = [
      '// 以前叫关闭、删掉',
      "const close = '关闭';",
      'const picked = `选了 ${count} 个`; const node = <h2>选了 {count} 篇</h2>;',
      "const tip = <p>正在存进笔记</p>; const ok = '正在保存…';",
      "const fail = '图片读不出来';",
    ].join('\n');
    expect(uiTexts(sample).flatMap(offenders)).toEqual(['关掉', '已选 n', '已选 n', '没读到']);
  });

  it('UI copy contains no disallowed glossary terms', () => {
    const files = SCANNED.flatMap(sourceFiles).filter((path) => !NOT_UI.some((pattern) => pattern.test(path)));
    const hits = files.flatMap((path) => uiTexts(readFileSync(path, 'utf8'))
      .flatMap((text) => offenders(text).map((use) => `${relative(ROOT, path)}：用「${use}」——「${text.trim()}」`)));
    expect(hits).toEqual([]);
  });
});
