// 磁盘不够：改成主线上的一条通知（《优化清单》第 12 条），一天一件；够用时什么都不发。

import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { NoticeInput } from '../../src/attention/index.ts';
import { scanDiskNotice } from '../../src/app/disk-notice.ts';

function poster(): { posted: NoticeInput[]; post(input: NoticeInput): boolean } {
  const posted: NoticeInput[] = [];
  return { posted, post: (input) => posted.push(input) > 0 };
}

test('可用不到 1 GB：发一件当天的通知，系统通知那一句不带数字以外的东西', () => {
  const notices = poster();
  scanDiskNotice({ notices, directory: '/', now: () => new Date('2026-11-07T04:00:00.000Z'),
    freeBytes: () => 512 * 1024 ** 2 });
  assert.equal(notices.posted.length, 1);
  assert.equal(notices.posted[0]?.key, 'disk-low:2026-11-07');
  assert.match(notices.posted[0]?.text ?? '', /0\.50 GB/);
  assert.equal(notices.posted[0]?.brief, '服务器磁盘空间不足');
  assert.ok(notices.posted[0]?.url.startsWith('/'));
});

test('够用时不发', () => {
  const notices = poster();
  scanDiskNotice({ notices, directory: '/', now: () => new Date(), freeBytes: () => 5 * 1024 ** 3 });
  assert.equal(notices.posted.length, 0);
});
