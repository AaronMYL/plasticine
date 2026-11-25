import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readSync } from '../src/tabs/tab-sync.ts';
import { reportedUrl } from '../src/tabs/tab-url.ts';

test('falls back to requested URL when new tab getURL() is still empty', () => {
  assert.equal(reportedUrl('', 'https://example.com/a'), 'https://example.com/a');
  assert.equal(reportedUrl('https://example.com/b', 'https://example.com/a'), 'https://example.com/b');
});

test('skips reporting when both URLs are empty or whitespace', () => {
  assert.equal(reportedUrl('', ''), null);
  assert.equal(reportedUrl(' ', ''), null);
});

test('drops tabs with empty URLs from manifest while rejecting manifest on other invalid fields', () => {
  const good = { tabId: 't1', url: 'https://example.com/' };
  const ok = { tabs: [good], active: 't1', frame: null, hitRegions: [] };
  assert.deepEqual(readSync(ok), { sync: ok, dropped: 0 });
  const stuck = { tabs: [good, { tabId: 't2', url: '' }], active: 't1', frame: null, hitRegions: [] };
  assert.deepEqual(readSync(stuck), { sync: ok, dropped: 1 });
  assert.deepEqual(readSync({ tabs: [{ tabId: 't2', url: '' }], active: 3, frame: null }), { sync: null, dropped: 0 });
  assert.deepEqual(readSync(null), { sync: null, dropped: 0 });
});
