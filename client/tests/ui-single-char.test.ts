// 第 7 批第 12 条（11-08 他定，长期规矩）：中文命名不用单字。按钮、标签、筛选、菜单项、读屏名、悬停提示都至少两个字
// （「人」→「联系人」、「改」→「修改」、「紧 / 松」→「紧凑 / 宽松」……）。扫客户端源码和 agent/shared 里的字符串和
// JSX 文字（扫描器同 ui-words.test.ts），整段只是一个汉字（或「· 新」这种一个字的尾巴）就不行。
// 下面的白名单是确实不是名字的：人称「你 / 我 / 他」、日期里拼出来的字（月、日、星期几）、拼句子的片段（「第 n 版」）、
// 判断用的关键字、装饰性的单字头像标记（模型提供商的「通」「智」）。新加的条目要写清为什么。

import { readFileSync } from 'node:fs';
import { relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ROOT, SCANNED, sourceFiles, uiTexts } from './source-texts.ts';

const SINGLE_CHAR = /^\s*(?:·\s*)?[一-鿿]\s*$/u;

/** 人称，哪里都可以。 */
const PRONOUNS = new Set(['你', '我', '他']);

/** 按文件放行的单字（路径相对仓库根）。 */
const ALLOWED: Readonly<Record<string, readonly string[]>> = {
  // 「11 月 8 日」这种日期拼接。
  'client/src/primitives/message/states.ts': ['月', '日'],
  // 「周一」「每周日」：星期几拼在「周」「每周」后面。
  'client/src/views/tasks/task-format.ts': ['日', '一', '二', '三', '四', '五', '六'],
  'client/src/views/library/subscription-text.ts': ['日', '一', '二', '三', '四', '五', '六'],
  // 行尾个数的读屏量词，拼在数字后面念「3 期」「2 项」，不是名字。
  'client/src/shell/columns/library-subscriptions.tsx': ['期', '项'],
  // 工具那一行按说的话挑图标：判断「看 / 搜 / 找 / 读」开头，不显示。
  'client/src/views/lines/line-parts.tsx': ['看', '搜', '找', '读'],
  // 提供商列表里头像方块上的一个字、抖音卡的来源方块（装饰，读屏不念，名字在旁边）。
  'client/src/views/models/model-store.ts': ['通', '智'],
  'client/src/views/feed/feed-body.tsx': ['抖'],
  // 队友设计稿的单字头像默认值，和现成起点（11-12）各自的头像字；名字和职责另有完整表单标签。
  'client/src/views/mates/mate-editor.tsx': ['友', '研', '编', '程', '码'],
  // 官网示例联系人的装饰头像，完整名字「阿杰」在旁边。
  'client/src/views/site/collab-demo.tsx': ['杰'],
  'client/src/views/site/site-page.tsx': ['杰'],
  // 「第 n 版」「有 n 篇」「删 《技能》？……」：JSX 里夹着数字、名字拼的一句话。
  'client/src/views/memory/change-log.tsx': ['第'],
  'client/src/views/notes/note-versions.tsx': ['第'],
  'client/src/views/notes/note-import.tsx': ['有'],
  'client/src/views/spaces/subscription-settings.tsx': ['日', '一', '二', '三', '四', '五', '六', '第'],
  'client/src/views/tools/money-view.tsx': ['有'],
  'client/src/views/settings/skills-section.tsx': ['删', '有'],
};

function bare(text: string): string {
  return text.replace(/[\s·]/gu, '');
}

export function singleCharHits(path: string, source: string): string[] {
  const file = relative(ROOT, path).replaceAll('\\', '/');
  const allowed = ALLOWED[file] ?? [];
  // JSX 文字和标签挤在一行时（`>改</button>`）按标签切开再看。
  return uiTexts(source).flatMap((text) => text.split(/<[^<>]*>|[<>]/u)).filter((text) => SINGLE_CHAR.test(text))
    .filter((text) => !PRONOUNS.has(bare(text)) && !allowed.includes(bare(text)))
    .map((text) => `${file}：「${text.trim()}」`);
}

describe('中文命名不用单字', () => {
  it('官网头像只放行指定文件的「杰」，其他字和应用中的名字仍检查', () => {
    const avatar = '<span>杰</span>';
    expect(singleCharHits(`${ROOT}/client/src/views/site/collab-demo.tsx`, avatar)).toEqual([]);
    expect(singleCharHits(`${ROOT}/client/src/views/site/site-page.tsx`, avatar)).toEqual([]);
    expect(singleCharHits(`${ROOT}/client/src/views/home/home.tsx`, avatar)).toHaveLength(1);
    expect(singleCharHits(`${ROOT}/client/src/views/site/site-page.tsx`, '<button>改</button>')).toHaveLength(1);
  });

  it('扫描器认得出按钮文字、读屏名、标签映射和「· 新」这种尾巴；人称放行', () => {
    const sample = [
      "const LABELS = { people: '人', mail: '邮件' };",
      'const button = <button type="button">改</button>;',
      'const icon = <IconButton label="赞" />;',
      "const tail = fresh ? ' · 新' : '';",
      "const who = mine ? '你' : name;",
      '// 注释里的「删」不算',
    ].join('\n');
    expect(singleCharHits(`${ROOT}/client/src/sample.tsx`, sample).map((hit) => hit.split('：')[1]))
      .toEqual(['「人」', '「改」', '「赞」', '「· 新」']);
  });

  it('界面文字里没有单个汉字的名字', () => {
    const hits = SCANNED.flatMap(sourceFiles).flatMap((path) => singleCharHits(path, readFileSync(path, 'utf8')));
    expect(hits).toEqual([]);
  });
});
