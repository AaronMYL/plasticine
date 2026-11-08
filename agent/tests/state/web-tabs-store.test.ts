// 竖排网页标签存进本体（迁移 0109，11-08）：书签在迁移里搬一次；整份写按版本，过时就拒；不在摆放里的行只记
// removed_at（不删）；合并旧存档时同一个网址只留一个、组按名字对上。

import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { WebTabsLayout } from '../../shared/api/web-tabs.ts';
import { mergeLayouts, normalizeLayout } from '../../shared/web-tabs-layout.ts';
import { MEMORY_DATABASE, openDatabase, type Database } from '../../src/state/db.ts';
import { migrate, MIGRATIONS } from '../../src/state/migrations/index.ts';
import type { StoreContext } from '../../src/state/object-store.ts';
import { StateError } from '../../src/state/index.ts';
import { createWebTabsStore } from '../../src/state/web-tabs.ts';
import { steppingClock } from './helpers.ts';

const ID = '0109-web-tabs';

function contextOf(db: Database): StoreContext {
  let next = 0;
  return { db, now: steppingClock(), newId: () => `id-${(next += 1)}` };
}

function tab(id: string, url: string, title = id) {
  return { id, kind: 'web' as const, url, title, openedBy: 'user' as const, openedAt: '2026-11-08T01:00:00.000Z',
    visitedAt: '2026-11-08T01:00:00.000Z' };
}

function layoutOf(partial: Partial<WebTabsLayout>): WebTabsLayout {
  return { tabs: [], pinned: [], groups: [], today: [], archived: [], ...partial };
}

function bookmark(db: Database, id: string, fields: { kind: string; title: string; target: string | null;
  tabs?: unknown[]; origin?: string; position: number; deleted?: boolean }): void {
  db.run(`INSERT INTO bookmarks (id, created_at, updated_at, version, kind, title, target, project_id, tabs, snapshot,
      snapshot_chars, origin, feed_item_id, position, deleted_at)
    VALUES ($id, '2026-11-03T00:00:00.000Z', '2026-11-03T00:00:00.000Z', 1, $kind, $title, $target, NULL, $tabs, NULL,
      0, $origin, NULL, $position, $deleted)`,
  { id, kind: fields.kind, title: fields.title, target: fields.target, tabs: JSON.stringify(fields.tabs ?? []),
    origin: fields.origin ?? 'manual', position: fields.position,
    deleted: fields.deleted === true ? '2026-11-04T00:00:00.000Z' : null });
}

test('迁移 0109 登记了、只加表；书签搬进分组一次：网页书签进「书签」（收起），保存的分组各成一组，旧表不动', () => {
  const entry = MIGRATIONS.find((migration) => migration.id === ID);
  assert.ok(entry !== undefined);
  assert.equal(entry.destructive, undefined);
  const db = openDatabase(MEMORY_DATABASE);
  migrate(db, MIGRATIONS.filter((migration) => migration.id < ID), steppingClock());
  bookmark(db, 'b1', { kind: 'web', title: 'Show HN', target: 'https://news.ycombinator.com/showhn.html',
    position: 0 });
  bookmark(db, 'b2', { kind: 'page', title: '一篇笔记', target: '#/notes/n1', position: 1 });
  bookmark(db, 'b3', { kind: 'web', title: '收藏的一条', target: 'https://feed.example.com/a', origin: 'feed',
    position: 2 });
  bookmark(db, 'b4', { kind: 'group', title: '读论文', target: null, position: 3, tabs: [
    { kind: 'web', title: 'arXiv', target: 'https://arxiv.org/abs/1' },
    { kind: 'page', title: '笔记', target: '#/notes/n2' },
    { kind: 'web', title: '重复的', target: 'https://news.ycombinator.com/showhn.html' },
  ] });
  bookmark(db, 'b5', { kind: 'web', title: '删掉的', target: 'https://gone.example.com/', position: 4, deleted: true });
  migrate(db, MIGRATIONS, steppingClock());
  const { layout, version } = createWebTabsStore(contextOf(db)).read();
  assert.equal(version, 1);
  assert.deepEqual(layout.groups.map((group) => [group.name, group.collapsed, group.tabIds.length]),
    [['书签', true, 1], ['读论文', true, 1]]);
  assert.deepEqual(layout.tabs.map((entry) => entry.url).sort(),
    ['https://arxiv.org/abs/1', 'https://news.ycombinator.com/showhn.html']);
  assert.equal(db.all('SELECT count(*) AS n FROM bookmarks')[0]?.['n'], 5);
  db.close();
});

test('没有书签：版本 0、空的摆放', () => {
  const db = openDatabase(MEMORY_DATABASE);
  migrate(db, MIGRATIONS, steppingClock());
  assert.deepEqual(createWebTabsStore(contextOf(db)).read(), { layout: layoutOf({}), version: 0 });
  db.close();
});

test('整份写：版本加一，读回一样；一样的不加版本；过时的版本拒绝；拿掉的标签行留着只记 removed_at', () => {
  const db = openDatabase(MEMORY_DATABASE);
  migrate(db, MIGRATIONS, steppingClock());
  const store = createWebTabsStore(contextOf(db));
  const first = layoutOf({
    tabs: [tab('a', 'https://a.example.com/'), tab('b', 'https://b.example.com/'), tab('c', 'https://c.example.com/')],
    pinned: ['a'], groups: [{ id: 'g1', name: '研究', hue: 'teal', collapsed: false, tabIds: ['b'] }], today: ['c'],
    archived: [{ key: 'x@1', url: 'https://x.example.com/', title: 'X', closedAt: '2026-11-07T00:00:00.000Z' }],
  });
  const saved = store.write(first, 0);
  assert.equal(saved.version, 1);
  assert.deepEqual(saved.layout, first);
  assert.equal(store.write(first, 1).version, 1);
  assert.throws(() => store.write(first, 0), (error: unknown) => error instanceof StateError
    && error.code === 'version_conflict' && error.currentVersion === 1);
  const second = layoutOf({ tabs: [tab('a', 'https://a.example.com/'), tab('c', 'https://c.example.com/')],
    pinned: [], groups: [], today: ['c', 'a'], archived: [] });
  assert.deepEqual(store.write(second, 1), { layout: normalizeLayout(second), version: 2 });
  const rows = db.all('SELECT id, removed_at FROM web_tabs ORDER BY id');
  assert.deepEqual(rows.map((row) => [row['id'], row['removed_at'] === null]), [['a', true], ['b', false],
    ['c', true]]);
  assert.equal(db.all('SELECT count(*) AS n FROM web_tab_groups WHERE removed_at IS NOT NULL')[0]?.['n'], 1);
  assert.equal(db.all('SELECT count(*) AS n FROM web_tabs_closed WHERE removed_at IS NOT NULL')[0]?.['n'], 1);
  db.close();
});

test('合并旧存档：同一个网址跳过，id 撞了换一个；组按名字对上，没有的新建；关掉的按时间并', () => {
  const base = layoutOf({ tabs: [tab('a', 'https://a.example.com/'), tab('b', 'https://b.example.com/')],
    groups: [{ id: 'g1', name: '研究', hue: 'teal', collapsed: false, tabIds: ['b'] }], today: ['a'],
    archived: [{ key: 'k1', url: 'https://old.example.com/', title: '旧', closedAt: '2026-11-06T00:00:00.000Z' }] });
  const local = layoutOf({
    tabs: [tab('a', 'https://dup.example.com/'), tab('x', 'https://b.example.com/'), tab('y', 'https://y.example.com/'),
      tab('z', 'https://z.example.com/')],
    pinned: ['y'],
    groups: [{ id: 'g9', name: '研究', hue: 'sky', collapsed: true, tabIds: ['x', 'a'] },
      { id: 'g1', name: '新的一组', hue: 'rose', collapsed: false, tabIds: ['z'] }],
    archived: [{ key: 'k2', url: 'https://new.example.com/', title: '新', closedAt: '2026-11-07T00:00:00.000Z' }],
  });
  let next = 0;
  const merged = mergeLayouts(base, local, () => `n${(next += 1)}`);
  assert.deepEqual(merged.tabs.map((entry) => [entry.id, entry.url]), [['y', 'https://y.example.com/'],
    ['b', 'https://b.example.com/'], ['n1', 'https://dup.example.com/'], ['z', 'https://z.example.com/'],
    ['a', 'https://a.example.com/']]);
  assert.deepEqual(merged.pinned, ['y']);
  assert.deepEqual(merged.groups.map((group) => [group.id, group.name, group.tabIds]),
    [['g1', '研究', ['b', 'n1']], ['group-n2', '新的一组', ['z']]]);
  assert.deepEqual(merged.archived.map((entry) => entry.key), ['k2', 'k1']);
});

test('规整：每个标签只在一处，没摆放的放进今天最上面，不认识的 id 拿掉', () => {
  const tabs = [tab('a', 'https://a/'), tab('b', 'https://b/'), tab('c', 'https://c/')];
  const layout = normalizeLayout(layoutOf({ tabs,
    pinned: ['a', 'ghost'], today: ['a', 'b'] }));
  assert.deepEqual([layout.pinned, layout.today], [['a'], ['c', 'b']]);
});

test('规整摆放：网址是空的标签和「关掉的」丢掉，其余不动（卡住的旧数据能送上去）', () => {
  const layout = normalizeLayout(layoutOf({
    tabs: [tab('a', 'https://a.example.com/'), tab('blank', '')],
    pinned: ['blank'], today: ['a'],
    archived: [{ key: 'x@1', url: '', title: 'X', closedAt: '2026-11-07T00:00:00.000Z' },
      { key: 'y@1', url: 'https://y.example.com/', title: 'Y', closedAt: '2026-11-07T00:00:00.000Z' }],
  }));
  assert.deepEqual(layout.tabs.map((entry) => entry.id), ['a']);
  assert.deepEqual(layout.pinned, []);
  assert.deepEqual(layout.today, ['a']);
  assert.deepEqual(layout.archived.map((entry) => entry.key), ['y@1']);
});
