// 第13批（11-14 Aaron：加「小红书」，抓首页「推荐」和自己的收藏，合并、去重，标「推荐」「收藏」，两处都有就两个标都留）：
// 电脑读小红书时先载入首页收推荐，再认出自己、载入自己主页的收藏那一页收收藏；同一条只交一次、带上在哪几处看到的；
// 没登录、要验证就停下说原因；收藏那一页没读到时首页读到的照交。

import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { XhsListedNote } from '../../client/src/mac/xhs-page.ts';
import { readXhs, type XhsPage } from '../src/feeds/xhs-read.ts';

const ME = '5f0a1b2c3d4e5f6a7b8c9d0e';
const PROFILE = `https://www.xiaohongshu.com/user/profile/${ME}?tab=fav&subTab=note`;

function note(id: string): XhsListedNote {
  return { id: id.padStart(24, '0'), title: `笔记 ${id}`, author: '收纳小周', avatar: null, image: null,
    imageRatio: null, video: false };
}

interface FakeOptions {
  /** 每个网址的页面状态。 */
  states?: Record<string, string>;
  notes: { explore?: XhsListedNote[]; profile?: XhsListedNote[] };
  me?: string | null;
  broken?: string[];
}

function fakeXhs(options: FakeOptions): XhsPage & { loads: string[] } {
  let url = '';
  const fake = {
    loads: [] as string[],
    async load(next: string): Promise<string | null> {
      fake.loads.push(next);
      url = next;
      return options.broken?.includes(next) === true ? 'net::ERR_TIMED_OUT' : null;
    },
    async run(code: string): Promise<unknown> {
      if (code === 'SCRIPT') return undefined;
      const name = /__plasticineXhs\.(\w+)\(/.exec(code)?.[1] ?? '';
      if (name === 'state') return options.states?.[url] ?? 'ready';
      if (name === 'me') return options.me === undefined ? ME : options.me;
      if (name === 'saved') return true;
      if (name === 'notes') return structuredClone(url === PROFILE ? options.notes.profile ?? []
        : options.notes.explore ?? []);
      return 0;
    },
  };
  return fake;
}

const OPTIONS = { script: 'SCRIPT', sleep: async () => undefined, log: () => undefined };

test('先首页收推荐，再到自己主页的收藏那一页收收藏；同一条只交一次，两处都有就两个标', async () => {
  const page = fakeXhs({ notes: { explore: [note('1'), note('2')], profile: [note('2'), note('3')] } });
  const report = await readXhs(page, OPTIONS);
  assert.equal(report.error, null);
  assert.deepEqual(page.loads, ['https://www.xiaohongshu.com/explore', PROFILE]);
  assert.deepEqual(report.notes.map((one) => [one.id.replace(/^0+/, ''), one.places]),
    [['1', ['recommend']], ['2', ['recommend', 'saved']], ['3', ['saved']]]);
});

test('没登录、要验证：停下说原因，不再载别的页', async () => {
  const signedOut = fakeXhs({ states: { 'https://www.xiaohongshu.com/explore': 'signed_out' }, notes: {} });
  assert.deepEqual(await readXhs(signedOut, OPTIONS), { notes: [], error: { code: 'signed_out' } });
  assert.equal(signedOut.loads.length, 1);
  const verify = fakeXhs({ states: { 'https://www.xiaohongshu.com/explore': 'verify' }, notes: {} });
  assert.deepEqual(await readXhs(verify, OPTIONS), { notes: [], error: { code: 'verify' } });
});

test('收藏那一页没读到（认不出自己、载不出、要验证）：首页读到的照交，记一行；两处都没读到才算没读成', async () => {
  const lines: string[] = [];
  const anonymous = await readXhs(fakeXhs({ me: null, notes: { explore: [note('1')] } }),
    { ...OPTIONS, log: (line) => lines.push(line) });
  assert.deepEqual(anonymous.notes.map((one) => one.places), [['recommend']]);
  const blocked = await readXhs(fakeXhs({ states: { [PROFILE]: 'verify' }, notes: { explore: [note('1')] } }),
    { ...OPTIONS, log: (line) => lines.push(line) });
  assert.equal(blocked.error, null);
  assert.equal(blocked.notes.length, 1);
  assert.equal(lines.length, 2);
  const none = await readXhs(fakeXhs({ notes: {}, broken: [PROFILE] }), OPTIONS);
  assert.deepEqual(none, { notes: [], error: { code: 'layout_changed' } });
  const down = await readXhs(fakeXhs({ notes: {}, broken: ['https://www.xiaohongshu.com/explore'] }), OPTIONS);
  assert.deepEqual(down, { notes: [], error: { code: 'load_failed', detail: 'net::ERR_TIMED_OUT' } });
});
