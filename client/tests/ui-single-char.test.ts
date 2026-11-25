import { readFileSync } from 'node:fs';
import { relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ROOT, SCANNED, sourceFiles, uiTexts } from './source-texts.ts';

const SINGLE_CHAR = /^\s*(?:·\s*)?[一-鿿]\s*$/u;

const PRONOUNS = new Set(['你', '我', '他']);

const ALLOWED: Readonly<Record<string, readonly string[]>> = {
  'client/src/primitives/message/states.ts': ['月', '日'],
  'client/src/views/tasks/task-format.ts': ['日', '一', '二', '三', '四', '五', '六'],
  'client/src/views/library/subscription-text.ts': ['日', '一', '二', '三', '四', '五', '六'],
  'client/src/shell/columns/library-subscriptions.tsx': ['期', '项'],
  'client/src/views/lines/line-parts.tsx': ['看', '搜', '找', '读'],
  'client/src/views/models/model-store.ts': ['通', '智'],
  'client/src/views/feed/feed-body.tsx': ['抖'],
  'client/src/views/notes/note-versions.tsx': ['第'],
  'client/src/views/notes/note-import.tsx': ['有'],
  'client/src/views/spaces/subscription-settings.tsx': ['日', '一', '二', '三', '四', '五', '六', '第'],
  'client/src/views/tools/money-view.tsx': ['有'],
};

function bare(text: string): string {
  return text.replace(/[\s·]/gu, '');
}

export function singleCharHits(path: string, source: string): string[] {
  const file = relative(ROOT, path).replaceAll('\\', '/');
  const allowed = ALLOWED[file] ?? [];
  return uiTexts(source).flatMap((text) => text.split(/<[^<>]*>|[<>]/u)).filter((text) => SINGLE_CHAR.test(text))
    .filter((text) => !PRONOUNS.has(bare(text)) && !allowed.includes(bare(text)))
    .map((text) => `${file}：「${text.trim()}」`);
}

describe('no single-character Chinese labels', () => {
  it('checks website and app labels identically with no allowlisted single chars', () => {
    const avatar = '<span>杰</span>';
    expect(singleCharHits(`${ROOT}/client/src/views/site/site-page.tsx`, avatar)).toHaveLength(1);
    expect(singleCharHits(`${ROOT}/client/src/views/home/home.tsx`, avatar)).toHaveLength(1);
    expect(singleCharHits(`${ROOT}/client/src/views/site/site-page.tsx`, '<button>改</button>')).toHaveLength(1);
  });

  it('scanner detects button text, aria labels, label maps, suffixes; allows pronouns', () => {
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

  it('UI copy contains no single-character Chinese labels', () => {
    const hits = SCANNED.flatMap(sourceFiles).flatMap((path) => singleCharHits(path, readFileSync(path, 'utf8')));
    expect(hits).toEqual([]);
  });
});
