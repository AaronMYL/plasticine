// 教模型写空间的说明（space-guide.ts）里提到的每个类，版式底子（agent/shared/space-page/）里都有：模型照着用，不会落空。
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BASE_CSS } from '../../shared/space-page/base-css.ts';
import { LETTER_CSS } from '../../shared/space-page/letter-css.ts';
import { REPORT_CSS } from '../../shared/space-page/report-css.ts';
import { LETTER_GUIDE, REPORT_GUIDE } from '../../src/subs/index.ts';

function classesIn(guide: string): string[] {
  const found = new Set<string>();
  for (const match of guide.matchAll(/class="([^"]+)"/g)) {
    for (const name of (match[1] ?? '').split(/\s+/)) {
      if (name !== '') found.add(name);
    }
  }
  return [...found];
}

test('报告和来信说明里的类都在底子里有样式', () => {
  const css = `${BASE_CSS}${REPORT_CSS}${LETTER_CSS}`;
  const missing = [...classesIn(REPORT_GUIDE), ...classesIn(LETTER_GUIDE)]
    .filter((name) => !new RegExp(`\\.${name.replace(/[-]/g, '\\-')}(?![\\w-])`).test(css));
  assert.deepEqual(missing, []);
});
