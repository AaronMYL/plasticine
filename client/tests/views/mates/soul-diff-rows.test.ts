// 第13批「看改动」：只摆改了的地方和它前后一行，没改的长段收成一行。
import { expect, it } from 'vitest';
import { diffSoul } from '../../../src/api/shared.ts';
import { diffRows } from '../../../src/views/mates/soul-field.tsx';

it('改动前后各留一行，远处没改的收成「没改的 n 行」', () => {
  const before = ['一', '二', '三', '四', '五', '六'].join('\n');
  const after = ['一', '二', '三', '四', '五改了', '六', '七'].join('\n');
  expect(diffRows(diffSoul(before, after))).toEqual([
    { kind: 'skip', count: 3 },
    { kind: 'same', text: '四' },
    { kind: 'remove', text: '五' },
    { kind: 'add', text: '五改了' },
    { kind: 'same', text: '六' },
    { kind: 'add', text: '七' },
  ]);
  expect(diffRows(diffSoul('一', '一'))).toEqual([{ kind: 'skip', count: 1 }]);
});
