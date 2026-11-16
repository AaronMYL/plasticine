// 记忆分层的搬家（11-15 Aaron 同意由 Claude 做）：经维护入口一次落库——几行按层挪到承诺和授权、主动告诉你、做事经验；
// 记忆页有一页记录，每条能搬回去（回到原来那一篇、原来那一段，出处不变）。11-15 那次还把一条旧约定写成了一行
// （事件里带 layers、没有 movedFrom）：旧约定的表删了以后这样的行照样列在记录里，搬回去是收回。

import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { Value } from 'typebox/value';
import { LayersMoveResponseSchema, MEMORY_LAYERS_MOVE_PATH, MEMORY_LAYERS_MOVE_UNDO_PATH,
  type LayersMoveResponse } from '../../shared/api/index.ts';
import { GRANTS_DOC_ID, PROACTIVE_DOC_ID, YOU_DOC_ID } from '../../shared/state.ts';
import { MaintenanceFailure, runMaintenance } from '../../src/app/maintenance.ts';
import { layersMoveView, undoLayersMove } from '../../src/memory/index.ts';
import { addLine, docEvent, ensureMemoryDocs } from '../../src/memory/docs/memory-doc-writes.ts';
import { call, json, pair, startTestApp, type TestApp } from './helpers.ts';

let t: TestApp | undefined;
afterEach(async () => {
  await t?.close();
  t = undefined;
});

const BECAUSE = '我的线上数据和记忆搬家也同意你做了';
const anchors = [{ kind: 'message' as const, ref: 'msg-1' }];

function said(app: TestApp, text: string) {
  return addLine(app.state, { docId: YOU_DOC_ID, text, basis: 'stated', anchors }, { actor: 'brain', ref: 'run' });
}

/** 11-15 线上那次搬家里从旧约定写成的那种行：出处指回旧约定，事件带这一批的操作号、没有 movedFrom。 */
function fromOldAgreement(app: TestApp, operationId: string, text: string, section: 'allow' | 'ask') {
  const writer = { actor: 'system' as const, ref: `maintenance:${operationId}` };
  const line = addLine(app.state, { docId: GRANTS_DOC_ID, section, text, basis: 'stated',
    anchors: [{ kind: 'agreement', ref: 'agreement-old-1' }] }, writer);
  docEvent(app.state, GRANTS_DOC_ID, line.id, 'line_added', writer,
    { section, basis: 'stated', layers: operationId, fromAgreement: 'agreement-old-1' });
  return line;
}

async function record(app: TestApp, cookie: string): Promise<LayersMoveResponse> {
  const body = json(await call(app, 'GET', MEMORY_LAYERS_MOVE_PATH, { cookie }));
  assert.ok(Value.Check(LayersMoveResponseSchema, body));
  return body;
}

test('搬家：几行按层挪过去；记录里列出搬了哪些、原来在哪、没动的有几行，从旧约定来的也在', async () => {
  t = await startTestApp();
  const cookie = await pair(t);
  ensureMemoryDocs(t.state);
  assert.equal((await record(t, cookie)).move, null, '没搬过');
  const home = said(t, '住在杭州');
  const quiet = said(t, '周末不提工作上的事');
  const mail = said(t, '发邮件之前先把草稿给我看');
  const done = runMaintenance({ state: t.state }, { operationId: 'layers-move-1', op: 'memory.layers', because: BECAUSE,
    moves: [{ lineId: quiet.id, version: quiet.version, toDocId: PROACTIVE_DOC_ID, section: 'never' },
      { lineId: mail.id, version: mail.version, toDocId: 'how:发邮件', section: 'do' }] });
  assert.deepEqual(done.result, { moved: 2 });
  fromOldAgreement(t, 'layers-move-1', '定时任务可以自己加，加完告诉你', 'allow');
  const never = t.state.memoryDocs.lines.live(PROACTIVE_DOC_ID);
  assert.deepEqual(never.map((line) => [line.section, line.text, line.anchors]),
    [['never', '周末不提工作上的事', anchors]]);
  const how = t.state.memoryDocs.docs.live().find((doc) => doc.kind === 'how');
  assert.equal(how?.title, '发邮件');
  assert.equal(t.state.memoryDocs.lines.live(how!.id)[0]?.basis, 'stated', '他说的做法，不是试出来的');
  const granted = t.state.memoryDocs.lines.live(GRANTS_DOC_ID)[0]!;
  assert.deepEqual([granted.section, granted.text, granted.anchors],
    ['allow', '定时任务可以自己加，加完告诉你', [{ kind: 'agreement', ref: 'agreement-old-1' }]]);
  assert.deepEqual(t.state.memoryDocs.lines.live(YOU_DOC_ID).map((line) => line.id), [home.id]);

  const { move } = await record(t, cookie);
  assert.ok(move !== null);
  assert.deepEqual(move.items.map((item) => [item.text, item.toTitle, item.section, item.fromTitle]).sort(), [
    ['发邮件之前先把草稿给我看', '发邮件', 'do', '关于你'],
    ['周末不提工作上的事', '主动告诉你', 'never', '关于你'],
    ['定时任务可以自己加，加完告诉你', '承诺和授权', 'allow', null],
  ].sort());
  assert.equal(move.kept, t.state.memoryDocs.lines.allLive().length - 3);
  assert.equal(runMaintenance({ state: t.state }, { operationId: 'layers-move-1', op: 'memory.layers',
    because: BECAUSE, moves: [{ lineId: quiet.id, version: quiet.version, toDocId: PROACTIVE_DOC_ID }] }).replayed,
  true, '同一个操作号重放不再动');
});

test('搬回去一条：回到原来那一篇，出处不变，记录里不再列；全部搬回去时从旧约定来的收回进归档', async () => {
  t = await startTestApp();
  const cookie = await pair(t);
  ensureMemoryDocs(t.state);
  const quiet = said(t, '周末不提工作上的事');
  const style = said(t, '一句话说完，细节放链接里');
  runMaintenance({ state: t.state }, { operationId: 'layers-move-2', op: 'memory.layers', because: BECAUSE,
    moves: [{ lineId: quiet.id, version: quiet.version, toDocId: PROACTIVE_DOC_ID, section: 'never' },
      { lineId: style.id, version: style.version, toDocId: PROACTIVE_DOC_ID, section: 'style' }] });
  fromOldAgreement(t, 'layers-move-2', '改线上数据之前先问', 'ask');
  const before = (await record(t, cookie)).move!;
  const moved = before.items.find((item) => item.text === '周末不提工作上的事')!;
  const one = await call(t, 'POST', MEMORY_LAYERS_MOVE_UNDO_PATH, { cookie,
    body: { requestId: 'layers-undo-one', lineIds: [moved.lineId] } });
  assert.equal(one.status, 200);
  const back = t.state.memoryDocs.lines.live(YOU_DOC_ID).find((line) => line.text === '周末不提工作上的事');
  assert.deepEqual([back?.section, back?.anchors], ['note', anchors]);
  assert.deepEqual((json(one) as LayersMoveResponse).move?.items.map((item) => item.text).sort(),
    ['一句话说完，细节放链接里', '改线上数据之前先问'].sort());
  const all = await call(t, 'POST', MEMORY_LAYERS_MOVE_UNDO_PATH, { cookie, body: { requestId: 'layers-undo-all' } });
  assert.deepEqual((json(all) as LayersMoveResponse).move?.items, []);
  assert.equal(t.state.memoryDocs.lines.live(PROACTIVE_DOC_ID).length, 0);
  assert.equal(t.state.memoryDocs.lines.live(GRANTS_DOC_ID).length, 0);
  assert.equal(t.state.memoryDocs.lines.archived(GRANTS_DOC_ID)[0]?.retiredReason, 'no_longer_true');
  assert.equal(t.state.memoryDocs.lines.live(YOU_DOC_ID).length, 2);
});

test('搬过去以后改过的那一行，记录里是改过的样子，照样能搬回去；有一行已经改过整批不动', async () => {
  t = await startTestApp();
  const cookie = await pair(t);
  ensureMemoryDocs(t.state);
  const quiet = said(t, '周末不提工作上的事');
  const stale = said(t, '晚上九点以后别发');
  t.state.memoryDocs.lines.retire(stale.id, stale.version, 'no_longer_true');
  assert.throws(() => runMaintenance({ state: t!.state }, { operationId: 'layers-move-3', op: 'memory.layers',
    because: BECAUSE, moves: [{ lineId: quiet.id, version: quiet.version, toDocId: PROACTIVE_DOC_ID },
      { lineId: stale.id, version: stale.version, toDocId: PROACTIVE_DOC_ID }] }), MaintenanceFailure);
  assert.equal(t.state.memoryDocs.lines.live(PROACTIVE_DOC_ID).length, 0, '整批不动');
  runMaintenance({ state: t.state }, { operationId: 'layers-move-4', op: 'memory.layers', because: BECAUSE,
    moves: [{ lineId: quiet.id, version: quiet.version, toDocId: PROACTIVE_DOC_ID }] });
  const moved = t.state.memoryDocs.lines.live(PROACTIVE_DOC_ID)[0]!;
  const edited = await call(t, 'PUT', `/v2/memory/docs/${PROACTIVE_DOC_ID}/lines/${moved.id}`, { cookie,
    body: { requestId: 'edit-moved-1', version: moved.version, text: '周末和节假日不提工作上的事' } });
  assert.equal(edited.status, 200);
  const item = (await record(t, cookie)).move!.items[0]!;
  assert.equal(item.text, '周末和节假日不提工作上的事');
  await call(t, 'POST', MEMORY_LAYERS_MOVE_UNDO_PATH, { cookie,
    body: { requestId: 'layers-undo-edited', lineIds: [item.lineId] } });
  assert.deepEqual(t.state.memoryDocs.lines.live(YOU_DOC_ID).map((line) => line.text), ['周末和节假日不提工作上的事']);
});

test('搬之前的样子留 7 天：过了就没有这页记录，也搬不回去了', async () => {
  t = await startTestApp();
  ensureMemoryDocs(t.state);
  const quiet = said(t, '周末不提工作上的事');
  runMaintenance({ state: t.state }, { operationId: 'layers-move-5', op: 'memory.layers', because: BECAUSE,
    moves: [{ lineId: quiet.id, version: quiet.version, toDocId: PROACTIVE_DOC_ID }] });
  const later = (days: number) => new Date(t!.clock.now().getTime() + days * 86_400_000);
  assert.equal(layersMoveView(t.state, later(6))?.items.length, 1);
  assert.equal(layersMoveView(t.state, later(8)), null);
  assert.equal(undoLayersMove(t.state, null, { actor: 'user', ref: 'device-1' }, later(8)), 0);
  assert.equal(t.state.memoryDocs.lines.live(PROACTIVE_DOC_ID).length, 1);
});
