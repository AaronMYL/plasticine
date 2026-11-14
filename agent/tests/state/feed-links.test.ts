import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';
import { openTestState, type TestState } from './helpers.ts';
import { SAFE_URL, unsafeUrl } from '../url-fixtures.ts';

let t: TestState;
beforeEach(async () => { t = await openTestState(); });
afterEach(async () => { await t.cleanup(); });

test('信息流存储入口直接调用：链接与存档只核对、存原样（11-14 起自己用不清洗），站点只从链接提取主机', () => {
  const source = t.state.feedSources.ensure({ ref: 'internal:manual', kind: 'internal', label: '手动添加' });
  const { item } = t.state.feedItems.add({
    sourceId: source.id, origin: 'manual', title: '文章', url: unsafeUrl(), site: unsafeUrl(),
    dedupeKey: 'safe-link', day: '2026-10-27', arrivedAt: '2026-10-27T08:00:00.000Z',
  }, { migratedDefault: true, legacyPayload: { url: unsafeUrl(), site: unsafeUrl() } });
  const raw = new URL(unsafeUrl()).href;
  const stored = t.state.feedItems.require(item.id);
  assert.equal(stored.url, raw);
  assert.equal(stored.site, 'example.com');
  assert.deepEqual(stored.legacyPayload, { url: raw, site: 'example.com' });
  assert.deepEqual(t.state.feedItems.recentSites(10), [{ site: 'example.com', count: 1 }]);
  const updated = t.state.feedItems.update(item.id, item.version, { note: `点评 ${unsafeUrl()}` });
  assert.equal(updated.note, `点评 ${raw}`);
});

test('再抓到同一条、带着以前洗掉的参数（小红书 xsec_token）：换成原链接；不是补参数的不换', () => {
  const source = t.state.feedSources.ensure({ ref: 'internal:manual', kind: 'internal', label: '手动添加' });
  const page = 'https://www.xiaohongshu.com/explore/6614a2b3000000001a0123ab';
  const first = t.state.feedItems.add({ sourceId: source.id, origin: 'feed', title: '笔记', url: page,
    dedupeKey: 'xhs:6614a2b3000000001a0123ab', day: '2026-11-14', arrivedAt: '2026-11-14T08:00:00.000Z' }).item;
  const withToken = `${page}?xsec_token=AB123%3D&xsec_source=pc_feed`;
  const again = t.state.feedItems.add({ sourceId: source.id, origin: 'feed', title: '笔记', url: withToken,
    dedupeKey: 'xhs:6614a2b3000000001a0123ab', day: '2026-11-14', arrivedAt: '2026-11-14T09:00:00.000Z' });
  assert.equal(again.created, false);
  assert.equal(again.item.url, withToken);
  assert.equal(again.item.version, first.version + 1);
  const other = t.state.feedItems.add({ sourceId: source.id, origin: 'feed', title: '笔记',
    url: 'https://www.xiaohongshu.com/explore/6614a2b3000000001a0123ff?xsec_token=AB',
    dedupeKey: 'xhs:6614a2b3000000001a0123ab', day: '2026-11-14', arrivedAt: '2026-11-14T10:00:00.000Z' });
  assert.equal(other.item.url, withToken, '指向别的地方的不换');
});

test('最近来源先按清洗后的主机合并再取上限，条目站点不采信输入值', () => {
  const source = t.state.feedSources.ensure({ ref: 'internal:manual', kind: 'internal', label: '手动添加' });
  const urls = ['https://a.example/one', 'https://b.example/one', 'https://b.example/two'];
  for (const [index, url] of urls.entries()) {
    const { item } = t.state.feedItems.add({
      sourceId: source.id, origin: 'manual', title: '文章', url, site: unsafeUrl(),
      dedupeKey: `host-${index}`, day: '2026-10-27', arrivedAt: '2026-10-27T08:00:00.000Z',
    });
    assert.equal(item.site, new URL(url).host);
  }
  assert.deepEqual(t.state.feedItems.recentSites(1), [{ site: 'b.example', count: 2 }]);
  assert.deepEqual(t.state.feedItems.recentSites(2), [
    { site: 'b.example', count: 2 }, { site: 'a.example', count: 1 },
  ]);
});

test('来源新建和修改：不要的网站只存主机名和稳定的主机引用，查询存原样（11-14 起自己用不清洗）', () => {
  const query = 'https://user:pass@example.com/feed?page=2&access_token=abc#token=abc';
  const source = t.state.feedSources.create({
    kind: 'blocked_site', label: unsafeUrl(), ref: `blocked:${unsafeUrl()}`, query,
  });
  assert.equal(source.label, 'example.com');
  assert.equal(source.ref, 'blocked:example.com');
  assert.equal(source.query, query);
  assert.equal(t.state.feedSources.byRef('blocked:example.com')?.id, source.id);
  const updated = t.state.feedSources.update(source.id, source.version, { label: unsafeUrl(), query: SAFE_URL });
  assert.equal(updated.label, 'example.com');
  assert.equal(updated.query, SAFE_URL);
});
