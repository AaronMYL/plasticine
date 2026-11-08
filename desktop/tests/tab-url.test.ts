import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readSync } from '../src/tabs/tab-sync.ts';
import { reportedUrl } from '../src/tabs/tab-url.ts';

test('新开的标签 getURL() 还是空的：报请求的网址，不报空网址', () => {
  assert.equal(reportedUrl('', 'https://example.com/a'), 'https://example.com/a');
  assert.equal(reportedUrl('https://example.com/b', 'https://example.com/a'), 'https://example.com/b');
});

test('两样都空（或只有空白）：这一次不报', () => {
  assert.equal(reportedUrl('', ''), null);
  assert.equal(reportedUrl(' ', ''), null);
});

test('标签清单里有空网址的标签：丢掉那几个，其余照用；别处不对整份不用', () => {
  const good = { tabId: 't1', url: 'https://example.com/' };
  const ok = { tabs: [good], active: 't1', frame: null, hitRegions: [] };
  assert.deepEqual(readSync(ok), { sync: ok, dropped: 0 });
  const stuck = { tabs: [good, { tabId: 't2', url: '' }], active: 't1', frame: null, hitRegions: [] };
  assert.deepEqual(readSync(stuck), { sync: ok, dropped: 1 });
  assert.deepEqual(readSync({ tabs: [{ tabId: 't2', url: '' }], active: 3, frame: null }), { sync: null, dropped: 0 });
  assert.deepEqual(readSync(null), { sync: null, dropped: 0 });
});
