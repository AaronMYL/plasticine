// 第13批（11-14 Aaron：主线和每位队友各一份 Soul；「你随时改，它们每晚自己改，能看能撤」）：读一份、他改、看一次改了
// 什么、撤回一次（之后又改过就不让撤、撤过的不再撤）；新建队友时写的那段就是它的 Soul。

import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { Value } from 'typebox/value';
import { SoulResponseSchema, SoulRevisionDiffResponseSchema } from '../../shared/api/index.ts';
import { MAIN_SOUL_OPENING } from '../../shared/soul-text.ts';
import { call, json, pair, startTestApp, type TestApp } from './helpers.ts';
import { newRequestId } from './signing.ts';

let t: TestApp | undefined;

afterEach(async () => {
  await t?.close();
  t = undefined;
});

interface SoulBody {
  soul: { owner: string; text: string; version: number };
  revisions: { id: string; actor: string; changes: number; undoneAt: string | null; undoes: string | null }[];
}

test('主线的 Soul：起步那段；他改了记一次、改了几处；看改动一行行标出；撤回回到原样，撤过的、过时的不让撤', async () => {
  t = await startTestApp();
  const cookie = await pair(t);
  const first = await call(t, 'GET', '/v2/souls/main', { cookie });
  assert.equal(first.status, 200);
  assert.ok(Value.Check(SoulResponseSchema, first.body));
  const start = first.body as SoulBody;
  assert.equal(start.soul.text, MAIN_SOUL_OPENING);
  assert.deepEqual(start.revisions.map((row) => row.actor), ['system']);

  const text = `${MAIN_SOUL_OPENING}\n\n## 说话\n- 先说结论，再说依据。`;
  const edited = await call(t, 'POST', '/v2/souls/main', { cookie,
    body: { requestId: newRequestId('soul'), version: start.soul.version, text } });
  assert.equal(edited.status, 200, JSON.stringify(edited.body));
  const after = edited.body as SoulBody;
  assert.equal(after.soul.text, text);
  assert.deepEqual(after.revisions.map((row) => row.actor), ['user', 'system']);
  assert.equal(after.revisions[0]?.changes, 1);
  const stale = await call(t, 'POST', '/v2/souls/main', { cookie,
    body: { requestId: newRequestId('soul'), version: start.soul.version, text: '别的' } });
  assert.equal(stale.status, 409);

  const revision = after.revisions[0]!;
  const diff = await call(t, 'GET', `/v2/souls/main/revisions/${revision.id}`, { cookie });
  assert.ok(Value.Check(SoulRevisionDiffResponseSchema, diff.body));
  assert.deepEqual((json(diff)['diff'] as { kind: string; text: string }[]).filter((line) => line.kind !== 'same'),
    [{ kind: 'add', text: '' }, { kind: 'add', text: '## 说话' }, { kind: 'add', text: '- 先说结论，再说依据。' }]);

  const undone = await call(t, 'POST', '/v2/souls/main/undo', { cookie,
    body: { requestId: newRequestId('undo'), revisionId: revision.id } });
  assert.equal(undone.status, 200, JSON.stringify(undone.body));
  const back = undone.body as SoulBody;
  assert.equal(back.soul.text, MAIN_SOUL_OPENING);
  assert.equal(back.revisions[0]?.undoes, revision.id);
  assert.notEqual(back.revisions[1]?.undoneAt, null);
  assert.equal((await call(t, 'POST', '/v2/souls/main/undo', { cookie,
    body: { requestId: newRequestId('undo'), revisionId: revision.id } })).status, 400);
  assert.equal((await call(t, 'GET', '/v2/souls/nobody', { cookie })).status, 404);
});

test('新建队友时写的那段就是它的 Soul；没写就照职责起一个「你是我的……」', async () => {
  t = await startTestApp();
  const cookie = await pair(t);
  const create = async (name: string, soul: string): Promise<string> => {
    const reply = await call(t!, 'POST', '/v2/mates', { cookie, body: { requestId: newRequestId('mate'), name,
      avatar: 'cat', hue: 'teal', role: '简历、投递和面试准备', soul, purpose: null } });
    assert.equal(reply.status, 201, JSON.stringify(reply.body));
    return String(json(reply)['id']);
  };
  const written = await create('求职顾问', '你是我的求职顾问。\n\n## 性格\n- 直接。');
  assert.equal((json(await call(t, 'GET', `/v2/souls/${written}`, { cookie }))['soul'] as SoulBody['soul']).text,
    '你是我的求职顾问。\n\n## 性格\n- 直接。');
  const blank = await create('面试教练', '');
  assert.equal((json(await call(t, 'GET', `/v2/souls/${blank}`, { cookie }))['soul'] as SoulBody['soul']).text,
    '你是我的面试教练：简历、投递和面试准备。');
});
