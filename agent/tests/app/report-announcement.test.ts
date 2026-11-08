// 后台线贴回主线时的系统通知那一句：只在没做成、没做完时弹（11-07 他定）；做成的只在主线上贴结果，不带标题和正文。

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { reportAnnouncement } from '../../src/app/report-announcement.ts';

const BASE = { role: 'lineReport' as const, lineId: 'l1', title: '设置每日续火花', text: '私密的结果', timestamp: 7 };

test('做成的不弹系统通知，只在主线上贴结果（11-07 他定「只在没做成时弹」）', () => {
  assert.equal(reportAnnouncement({ ...BASE, outcome: 'done' }), null);
});

test('没做成、没做完各一句，链到和 Plasticine 的对话，不带标题和正文', () => {
  assert.equal(reportAnnouncement({ ...BASE, outcome: 'done', unmet: '建不了' })?.body, '后台的一件事没做成');
  assert.equal(reportAnnouncement({ ...BASE, outcome: 'failed' })?.body, '后台的一件事没做完');
  assert.equal(reportAnnouncement({ ...BASE, outcome: 'paused' }), null, '额度用完的那一句不通知');
  const failed = reportAnnouncement({ ...BASE, outcome: 'failed' });
  assert.equal(failed?.url, '/#/plasticine');
  assert.equal(failed?.tag, 'line-report:l1:7');
  assert.doesNotMatch(JSON.stringify(failed), /续火花|私密/);
});
