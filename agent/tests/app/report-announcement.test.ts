import assert from 'node:assert/strict';
import { test } from 'node:test';
import { reportAnnouncement } from '../../src/app/report-announcement.ts';

const BASE = { role: 'lineReport' as const, lineId: 'l1', title: '设置每日续火花', text: '私密的结果', timestamp: 7 };

test('completed background work posts to main line without system push notification', () => {
  assert.equal(reportAnnouncement({ ...BASE, outcome: 'done' }), null);
});

test('failed and incomplete background work send one-line notice linking to chat without title/body', () => {
  assert.equal(reportAnnouncement({ ...BASE, outcome: 'done', unmet: '建不了' })?.body, '后台的一件事没做成');
  assert.equal(reportAnnouncement({ ...BASE, outcome: 'failed' })?.body, '后台的一件事没做完');
  assert.equal(reportAnnouncement({ ...BASE, outcome: 'paused' }), null, '额度用完的那一句不通知');
  const failed = reportAnnouncement({ ...BASE, outcome: 'failed' });
  assert.equal(failed?.url, '/#/plasticine');
  assert.equal(failed?.tag, 'line-report:l1:7');
  assert.doesNotMatch(JSON.stringify(failed), /续火花|私密/);
});
