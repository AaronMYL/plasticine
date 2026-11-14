// 第13批规则搬家（11-14 Aaron 选「按三层分，你勾了才搬」）：「规则」里每一条先给建议去处——只对某位队友的进那位的 Soul，
// 他说过的进「关于你」，对外授权的系统默认本来在产品里（默认不勾），别的系统默认进主线的 Soul；勾了才搬，没勾的留着。

import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { Value } from 'typebox/value';
import { RulesMoveResponseSchema } from '../../shared/api/index.ts';
import { call, json, pair, startTestApp, type TestApp } from './helpers.ts';
import { newRequestId } from './signing.ts';

let t: TestApp | undefined;

afterEach(async () => {
  await t?.close();
  t = undefined;
});

interface Item { id: string; version: number; text: string; moved: string; source: string;
  dest: { kind: string; owner: string | null }; suggested: boolean }

test('先分一遍给建议；照勾的搬：进 Soul 的按节加、「用户」写成「我」，进「关于你」的照原样，没勾的留在「规则」里', async () => {
  t = await startTestApp();
  const cookie = await pair(t);
  const mate = await call(t, 'POST', '/v2/mates', { cookie, body: { requestId: newRequestId('mate'),
    name: '求职顾问', avatar: 'cat', hue: 'teal', role: '简历和投递', soul: '', purpose: null } });
  const mateId = String(json(mate)['id']);
  await call(t, 'GET', '/v2/soul', { cookie });
  const add = (text: string, section: string, scope?: string): Promise<unknown> => call(t!, 'POST', '/v2/soul',
    { cookie, body: { requestId: newRequestId('rule'), action: 'add', text, section,
      ...(scope === undefined ? {} : { scopeKind: 'mate', scopeRef: scope }) } });
  await add('回复用中文，先说结论。', 'speaking');
  await add('投递前先给我看一眼，「投递」我自己点。', 'doing', mateId);

  const view = await call(t, 'GET', '/v2/memory/rules-move', { cookie });
  assert.equal(view.status, 200);
  assert.ok(Value.Check(RulesMoveResponseSchema, view.body));
  const items = json(view)['items'] as Item[];
  const find = (text: RegExp): Item => items.find((item) => text.test(item.text))!;
  assert.deepEqual(find(/回复用中文/).dest, { kind: 'about_you', owner: null });
  assert.deepEqual(find(/投递前/).dest, { kind: 'soul', owner: mateId });
  assert.deepEqual(find(/不确定/).dest, { kind: 'soul', owner: 'main' });
  const authority = find(/名义对外/);
  assert.deepEqual([authority.dest.kind, authority.suggested], ['product', false]);
  assert.equal(authority.moved, '以我的名义对外，照已授权的范围做；超出范围先问我。');
  assert.deepEqual((json(view)['owners'] as { owner: string; name: string }[]).map((row) => row.name),
    ['Plasticine', '求职顾问']);

  const ticked = items.filter((item) => item.suggested);
  const moved = await call(t, 'POST', '/v2/memory/rules-move', { cookie, body: { requestId: newRequestId('move'),
    moves: ticked.map((item) => ({ id: item.id, version: item.version, dest: item.dest })) } });
  assert.equal(moved.status, 200, JSON.stringify(moved.body));
  assert.deepEqual(moved.body, { moved: ticked.length, remaining: 1 });
  const main = (json(await call(t, 'GET', '/v2/souls/main', { cookie }))['soul'] as { text: string }).text;
  assert.match(main, /## 说话\n- 直接讲内容，先说结论。\n- 不写边界声明/);
  assert.match(main, /## 和我相处中形成的判断\n- 能做的直接做；要我定的给选项/);
  const own = (json(await call(t, 'GET', `/v2/souls/${mateId}`, { cookie }))['soul'] as { text: string }).text;
  assert.match(own, /## 和我相处中形成的判断\n- 投递前先给我看一眼/);
  const left = json(await call(t, 'GET', '/v2/memory/rules-move', { cookie }))['items'] as Item[];
  assert.deepEqual(left.map((item) => item.text), ['以用户的名义对外，照已授权的范围做；超出范围先问用户。']);
  const you = json(await call(t, 'GET', '/v2/memory/topics/memdoc-you', { cookie }));
  assert.match(JSON.stringify(you), /回复用中文，先说结论。/);
  const revisions = json(await call(t, 'GET', '/v2/souls/main', { cookie }))['revisions'] as
    { actor: string; note: string }[];
  assert.deepEqual([revisions[0]?.actor, revisions[0]?.note], ['move', '规则搬家：搬进来 5 条']);
  // 再搬一次（搬过的）：版本对不上，整批不搬。
  const again = await call(t, 'POST', '/v2/memory/rules-move', { cookie, body: { requestId: newRequestId('move'),
    moves: [{ id: ticked[0]!.id, version: ticked[0]!.version, dest: ticked[0]!.dest }] } });
  assert.equal(again.status, 409);
});
