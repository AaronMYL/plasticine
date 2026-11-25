import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { XPost } from '../../agent/shared/api/index.ts';
import { readXPlaces, type XPage } from '../src/feeds/x-places.ts';

function post(id: string, text = `帖子 ${id}`): XPost {
  return { id, handle: 'mayabuilds', author: 'Maya Chen', avatar: null, text, image: null, imageRatio: null,
    publishedAt: '2026-11-14T06:00:00.000Z' };
}

interface FakeOptions {
  state?: string;
  posts: Partial<Record<'following' | 'recommend' | 'bookmark', XPost[]>>;
  broken?: string[];
  missingTabs?: string[];
  truncated?: string[];
  full?: Record<string, string>;
}

function fakeX(options: FakeOptions): XPage & { loads: string[]; scripts: number } {
  let url = '';
  let tab: 'following' | 'recommend' = 'recommend';
  const fake = {
    loads: [] as string[],
    scripts: 0,
    async load(next: string): Promise<string | null> {
      fake.loads.push(next);
      url = next;
      return options.broken?.includes(next) === true ? 'net::ERR_CONNECTION_RESET' : null;
    },
    async run(code: string): Promise<unknown> {
      if (code === 'SCRIPT') {
        fake.scripts += 1;
        return undefined;
      }
      const call = /__plasticineX\.(\w+)\((.*)\)/.exec(code);
      const name = call?.[1] ?? '';
      if (name === 'state') return options.state ?? 'ready';
      if (name === 'following' || name === 'recommend') {
        if (options.missingTabs?.includes(name) === true) return null;
        const switched = tab !== name;
        tab = name;
        return switched;
      }
      if (name === 'posts') {
        const place = url.endsWith('/i/bookmarks') ? 'bookmark' : tab;
        return structuredClone(options.posts[place] ?? []);
      }
      if (name === 'truncated') return options.truncated ?? [];
      if (name === 'fullText') return options.full?.[JSON.parse(call?.[2] ?? '""') as string] ?? null;
      return 0;
    },
  };
  return fake;
}

const OPTIONS = { script: 'SCRIPT', sleep: async () => undefined, log: () => undefined };

test('reads Following, For You, and Bookmarks in order, deduplicating and tagging seen locations', async () => {
  const page = fakeX({ posts: { following: [post('1'), post('2')], recommend: [post('3'), post('2')],
    bookmark: [post('1'), post('4')] } });
  const report = await readXPlaces(page, OPTIONS);
  assert.equal(report.error, null);
  assert.deepEqual(page.loads, ['https://x.com/home', 'https://x.com/home', 'https://x.com/i/bookmarks']);
  assert.equal(page.scripts, 3);
  assert.deepEqual(report.posts.map((one) => [one.id, one.places]), [
    ['1', ['following', 'bookmark']], ['2', ['following', 'recommend']], ['3', ['recommend']], ['4', ['bookmark']],
  ]);
});

test('stops at first page and returns not logged in without loading remaining pages', async () => {
  const page = fakeX({ state: 'signed_out', posts: { following: [post('1')] } });
  const report = await readXPlaces(page, OPTIONS);
  assert.deepEqual(report, { posts: [], error: { code: 'signed_out' } });
  assert.deepEqual(page.loads, ['https://x.com/home']);
});

test('skips individual failed pages and submits remaining; fails only when all 3 fail', async () => {
  const lines: string[] = [];
  const page = fakeX({ posts: { following: [post('1')], recommend: [post('9')] }, missingTabs: ['recommend'],
    broken: ['https://x.com/i/bookmarks'] });
  const report = await readXPlaces(page, { ...OPTIONS, log: (line) => lines.push(line) });
  assert.equal(report.error, null);
  assert.deepEqual(report.posts.map((one) => [one.id, one.places]), [['1', ['following']]]);
  assert.equal(lines.length, 2);
  assert.match(lines.join('\n'), /为你推荐/);
  assert.match(lines.join('\n'), /书签.*ERR_CONNECTION_RESET/);

  const empty = await readXPlaces(fakeX({ posts: {}, broken: ['https://x.com/i/bookmarks'] }), OPTIONS);
  assert.deepEqual(empty, { posts: [], error: { code: 'layout_changed' } });
  const down = await readXPlaces(fakeX({ posts: {}, broken: ['https://x.com/home', 'https://x.com/i/bookmarks'] }),
    OPTIONS);
  assert.deepEqual(down, { posts: [], error: { code: 'load_failed', detail: 'net::ERR_CONNECTION_RESET' } });
});

test('fetches full text per truncated long post after finishing all 3 pages', async () => {
  const page = fakeX({ posts: { following: [post('1', '开头一段')], bookmark: [post('2')] }, truncated: ['1'],
    full: { 1: '开头一段，后面还有很长的全文。' } });
  const report = await readXPlaces(page, OPTIONS);
  assert.equal(report.posts[0]?.text, '开头一段，后面还有很长的全文。');
  assert.equal(page.loads.at(-1), 'https://x.com/mayabuilds/status/1');
});
