// 用词表（11-14 界面统一，Aaron 弹框选，设计稿「用词、时间、搜索框、多选、头像」）：同一件事一个词。界面文字里出现「不用」
// 那一列的词就不通过——关闭（用关掉）、删掉（用删除；从一组里拿掉用移除）、彻底删除（用永久删除）、算了 / 不用了（用取消）、
// 再试一次（用重试）、选了 n（用已选 n）、正在读取（用正在读）、正在存（用正在保存）、未能读取 / 读不出来 / 读取失败
// （用没读到）、进行中（用在做，11-17）。和 ui-words.test.ts 共用扫描器：只看字符串和 JSX 文字，注释、测试、假接口的示例数据不算。

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
  // 「选了 {n}」在 JSX 里是「选了 」一段字后面跟一个表达式：字的末尾也算。
  { pattern: new RegExp(`选了\\s*(\\d|${HOLE}|$)`, 'u'), use: '已选 n' },
  { pattern: /正在读取/u, use: '正在读' },
  { pattern: /正在存(?!进)/u, use: '正在保存' },
  { pattern: /未能读取|读不出来|读取失败/u, use: '没读到' },
  // 11-17 用户定：正在做着的事一律写「在做」（首页、任务页、分工面板本来就这么写），不写「进行中」。
  { pattern: /进行中/u, use: '在做' },
];

/** 不是界面文字的文件：page-operate.ts 是装进网页里的脚本，里面的词是拿来认网页上的按钮的（「删掉」「注销」……）。 */
const NOT_UI = [/[\\/]mac[\\/]page-operate\.ts$/];

function offenders(text: string): string[] {
  return GLOSSARY.filter((rule) => rule.pattern.test(text)).map((rule) => rule.use);
}

describe('界面用词表', () => {
  it('认得出「不用」那一列的词，注释里的不算', () => {
    const sample = [
      '// 以前叫关闭、删掉',
      "const close = '关闭';",
      'const picked = `选了 ${count} 个`; const node = <h2>选了 {count} 篇</h2>;',
      "const tip = <p>正在存进笔记</p>; const ok = '正在保存…';",
      "const fail = '图片读不出来';",
    ].join('\n');
    expect(uiTexts(sample).flatMap(offenders)).toEqual(['关掉', '已选 n', '已选 n', '没读到']);
  });

  it('界面文字里没有用词表「不用」那一列的词', () => {
    const files = SCANNED.flatMap(sourceFiles).filter((path) => !NOT_UI.some((pattern) => pattern.test(path)));
    const hits = files.flatMap((path) => uiTexts(readFileSync(path, 'utf8'))
      .flatMap((text) => offenders(text).map((use) => `${relative(ROOT, path)}：用「${use}」——「${text.trim()}」`)));
    expect(hits).toEqual([]);
  });
});
