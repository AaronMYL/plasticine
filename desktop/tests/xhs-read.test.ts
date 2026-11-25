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

test('collects Home feed then profile Favorites, deduplicating and tagging items seen in both', async () => {
  const page = fakeXhs({ notes: { explore: [note('1'), note('2')], profile: [note('2'), note('3')] } });
  const report = await readXhs(page, OPTIONS);
  assert.equal(report.error, null);
  assert.deepEqual(page.loads, ['https://www.xiaohongshu.com/explore', PROFILE]);
  assert.deepEqual(report.notes.map((one) => [one.id.replace(/^0+/, ''), one.places]),
    [['1', ['recommend']], ['2', ['recommend', 'saved']], ['3', ['saved']]]);
});

test('attaches xsec_token and backfills it from Favorites when missing on Home item', async () => {
  const withToken = (id: string, xsecToken: string): XhsListedNote => ({ ...note(id), xsecToken });
  const page = fakeXhs({ notes: { explore: [note('1'), withToken('2', 'AB2=')], profile: [withToken('1', 'AB1=')] } });
  const report = await readXhs(page, OPTIONS);
  assert.deepEqual(report.notes.map((one) => [one.id.replace(/^0+/, ''), one.xsecToken]),
    [['1', 'AB1='], ['2', 'AB2=']]);
});

test('stops and reports reason on not logged in or verification challenge without loading more', async () => {
  const signedOut = fakeXhs({ states: { 'https://www.xiaohongshu.com/explore': 'signed_out' }, notes: {} });
  assert.deepEqual(await readXhs(signedOut, OPTIONS), { notes: [], error: { code: 'signed_out' } });
  assert.equal(signedOut.loads.length, 1);
  const verify = fakeXhs({ states: { 'https://www.xiaohongshu.com/explore': 'verify' }, notes: {} });
  assert.deepEqual(await readXhs(verify, OPTIONS), { notes: [], error: { code: 'verify' } });
});

test('submits Home items with note if Favorites fails; fails only when both fail', async () => {
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
