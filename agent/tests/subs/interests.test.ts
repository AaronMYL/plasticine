import assert from 'node:assert/strict';
import { test } from 'node:test';
import { rankInterests } from '../../src/subs/index.ts';

test('Priority: explicit > starred > active project > recent chat; dedupes by name', () => {
  const ranked = rankInterests({
    explicit: ['睡眠', '记忆巩固'],
    saved: ['指数定投', '睡眠'],
    projects: [{ id: 'p1', name: 'Cyber Hunter' }],
    talk: [
      { day: '2026-11-05', docId: 'd1', title: '侧栏方案' },
      { day: '2026-11-06', docId: 'd1', title: '侧栏方案' },
    ],
  });
  assert.deepEqual(ranked.map((item) => [item.label, item.why]), [
    ['睡眠', 'explicit'], ['记忆巩固', 'explicit'], ['指数定投', 'saved'], ['Cyber Hunter', 'project'],
    ['侧栏方案', 'talk'],
  ]);
});

test('Chat topic counts only if repeated across multiple days, not 3x same day or once', () => {
  const ranked = rankInterests({ explicit: [], saved: [], projects: [], talk: [
    { day: '2026-11-06', docId: 'd1', title: '签证' },
    { day: '2026-11-06', docId: 'd1', title: '签证' },
    { day: '2026-11-06', docId: 'd1', title: '签证' },
    { day: '2026-11-04', docId: 'd2', title: '健身' },
    { day: '2026-11-05', docId: 'd2', title: '健身' },
    { day: '2026-11-06', docId: 'd2', title: '健身' },
    { day: '2026-11-03', docId: 'd3', title: '只问过一次' },
  ] });
  assert.deepEqual(ranked.map((item) => [item.label, item.days]), [['健身', 3]]);
});
