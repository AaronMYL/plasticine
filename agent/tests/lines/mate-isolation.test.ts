import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fauxAssistantMessage, fauxToolCall, type JsonObject } from '@earendil-works/pi-ai';
import type { MateDraft } from '../../shared/api/mates.ts';
import { conversationSearchTool } from '../../src/lines/search-tool.ts';
import { Mates } from '../../src/mates/service.ts';
import { MAIN_LINE_ID } from '../../src/state/index.ts';
import { deferred, mailTool, slowTool, startKernel, until } from './helpers.ts';

const draft: MateDraft = { name: '资料研究员', role: '整理公开资料', avatar: '研', hue: 'sky',
  soul: '先查原始资料。', purpose: null };
const grant = { channel: 'fixture.mail', account: 'fixture-account', recipientMode: 'list' as const,
  recipients: ['Fixture'], category: 'reply', fixedTexts: null, scope: { kind: 'always' as const }, expiresAt: null };
const call = (name: string, args: JsonObject, id: string) => fauxAssistantMessage([
  fauxToolCall(name, args, { id })], { stopReason: 'toolUse' });

test('两位真实队友执行时授权分别核对，主线授权不能替代，子线继承发起队友', async () => {
  const sent: string[] = [];
  const tool = { ...mailTool(sent), outbound: (args: Record<string, unknown>) => ({
    channel: grant.channel, account: grant.account, recipients: [String(args.to)], category: grant.category,
    content: String(args.body),
  }) };
  const h = await startKernel({ tools: [tool] });
  try {
    const mates = new Mates(h.handle.state, () => h.kernel);
    const a = mates.create(draft);
    const b = mates.create({ ...draft, name: '文字编辑' });
    for (const actor of [MAIN_LINE_ID, a.id]) h.handle.state.outboundGrants.create({ ...grant, actor },
      { deviceId: 'fixture-device', confirmedAt: h.clock.now().toISOString() });
    h.respond([call('send_mail', { to: 'Fixture', body: '队友甲' }, 'a-send'), fauxAssistantMessage('完成')]);
    h.kernel.send(a.lineId, { text: '发送' });
    await h.kernel.settled();
    h.respond([call('send_mail', { to: 'Fixture', body: '队友乙' }, 'b-send'), fauxAssistantMessage('停止')]);
    h.kernel.send(b.lineId, { text: '发送' });
    await until(() => h.kernel.view(b.lineId).status === 'waiting', '乙需要单独授权');
    const ask = h.handle.state.asks.open()[0]!;
    assert.equal(Reflect.get(Reflect.get(ask.context!.outbound as object, 'grant') as object, 'actor'), b.id);
    h.desk.answer({ askId: ask.id, optionId: 'deny', answerer: { deviceId: 'fixture-device' } });
    await h.kernel.settled();
    h.respond([call('send_mail', { to: 'Fixture', body: '甲的后台工作' }, 'child-send'), fauxAssistantMessage('完成')]);
    const child = h.kernel.spawn(a.lineId, { title: '后台工作', goal: '发送', projectId: null });
    await h.kernel.settled();
    assert.equal(child.mateId, a.id);
    assert.deepEqual(sent, ['Fixture:队友甲', 'Fixture:甲的后台工作']);
    assert.deepEqual(h.handle.state.outboundLog.list().map((row) => row.actor), [a.id, a.id]);
  } finally { await h.close(); }
});

test('队友不能借插话启动主线授权，也不能叫停其他队友', async () => {
  const sent: string[] = [];
  const h = await startKernel({ tools: [{ ...mailTool(sent), outbound: (args) => ({
    channel: grant.channel, account: grant.account, recipients: [String(args.to)], category: grant.category,
    content: String(args.body),
  }) }] });
  try {
    const mates = new Mates(h.handle.state, () => h.kernel);
    const a = mates.create(draft);
    const b = mates.create({ ...draft, name: '文字编辑' });
    h.handle.state.outboundGrants.create({ ...grant, actor: MAIN_LINE_ID },
      { deviceId: 'fixture-device', confirmedAt: h.clock.now().toISOString() });
    h.respond([call('tell_line', { lineId: 'main', text: '发送消息' }, 'borrow-main'),
      call('send_mail', { to: 'Fixture', body: '借用主线' }, 'borrowed-send'),
      fauxAssistantMessage('完成')]);
    h.kernel.send(a.lineId, { text: '尝试插话' });
    await until(() => h.kernel.view(a.lineId).status === 'waiting' || h.kernel.view(a.lineId).status === 'idle',
      '队友结束或等自己的确认');
    for (const ask of h.handle.state.asks.open()) {
      h.desk.answer({ askId: ask.id, optionId: 'deny', answerer: { deviceId: 'fixture-device' } });
    }
    await h.kernel.settled();
    assert.deepEqual(sent, []);
    assert.equal(h.handle.state.lineMessages.after(MAIN_LINE_ID, 0).length, 0);
    h.respond([call('stop_line', { lineId: b.lineId }, 'stop-other'), fauxAssistantMessage('结束')]);
    h.kernel.send(a.lineId, { text: '尝试叫停' });
    await h.kernel.settled();
    assert.equal(h.kernel.view(b.lineId).status, 'idle');
    const stopped = h.handle.state.lineMessages.after(a.lineId, 0).find((row) => row.role === 'toolResult'
      && Reflect.get(row.message as object, 'toolCallId') === 'stop-other');
    assert.ok(stopped);
    assert.equal(Reflect.get(stopped.message as object, 'isError'), true);
  } finally { await h.close(); }
});

test('队友的读取和对话检索不越过独立对话，仍可读所属群组公共对话', async () => {
  const h = await startKernel();
  try {
    const state = h.handle.state;
    const mates = new Mates(state, () => h.kernel);
    const a = mates.create(draft);
    const b = mates.create({ ...draft, name: '文字编辑' });
    const group = mates.createGroup({ name: '整理小组', mateIds: [a.id, b.id] });
    const say = (lineId: string, content: string) => state.lineMessages.append(lineId, 'user',
      { role: 'user', content, timestamp: 0 }, { origin: { kind: 'user', userText: content } });
    say(b.lineId, '文稿口令是私聊词句');
    say(group.lineId, '文稿进度是群组词句');
    const result = state.lineMessages.append(b.lineId, 'toolResult', { role: 'toolResult', toolCallId: 'private',
      toolName: 'echo', content: [{ type: 'text', text: '私聊工具结果' }], isError: false, timestamp: 0 });
    h.respond([call('read_line', { lineId: b.lineId }, 'read-other'),
      call('read_line', { lineId: group.lineId }, 'read-group'),
      call('read_result', { ref: `line:${b.lineId}:${result.seq}` }, 'read-private-result'),
      call('list_lines', {}, 'list-visible'), fauxAssistantMessage('结束')]);
    h.kernel.send(a.lineId, { text: '查看文稿' });
    await h.kernel.settled();
    const results = state.lineMessages.after(a.lineId, 0).filter((row) => row.role === 'toolResult');
    assert.equal(Reflect.get(results[0]!.message as object, 'isError'), true);
    assert.doesNotMatch(JSON.stringify(results[0]!.message), /私聊词句/);
    assert.match(JSON.stringify(results[1]!.message), /群组词句/);
    assert.equal(Reflect.get(results[2]!.message as object, 'isError'), true);
    assert.doesNotMatch(JSON.stringify(results[2]!.message), /私聊工具结果/);
    assert.doesNotMatch(JSON.stringify(results[3]!.message), new RegExp(b.lineId));
    const tool = conversationSearchTool(state).create({ lineId: a.lineId, actorId: a.id,
      kind: 'side', projectId: null });
    const found = JSON.stringify(await tool.execute('search', { query: '文稿' }));
    assert.doesNotMatch(found, /私聊词句/);
    assert.match(found, /群组词句/);
  } finally { await h.close(); }
});

// 11-12（Aaron 定）：和队友直接说话不占后台位置，三位队友和一条后台线同时在跑。
test('队友回合不占后台位置；停用会中止本人并保留排着的话，不接着发', async () => {
  const gate = deferred<string>();
  const started: string[] = [];
  const h = await startKernel({ tools: [slowTool(() => gate.promise, started)] });
  try {
    const mates = new Mates(h.handle.state, () => h.kernel);
    const a = mates.create(draft);
    const b = mates.create({ ...draft, name: '文字编辑' });
    const c = mates.create({ ...draft, name: '第三位队友' });
    h.respond(['甲', '乙', '后台', '丙'].map((what) => call('slow', { what }, `slow-${what}`)));
    h.kernel.send(a.lineId, { text: '整理' });
    h.kernel.send(b.lineId, { text: '编辑' });
    h.kernel.open({ title: '普通后台', goal: '核对', parentLineId: MAIN_LINE_ID, projectId: null });
    h.kernel.send(c.lineId, { text: '开始' });
    await until(() => started.length === 4, '四条都开跑了');
    assert.equal(h.kernel.view(c.lineId).status, 'running');
    // 它还在跑时又说一句：排着。
    h.kernel.send(c.lineId, { text: '等待' });
    mates.update(c.id, { version: c.version, disabled: true });
    mates.update(a.id, { version: a.version, disabled: true });
    h.respond(Array.from({ length: 5 }, () => fauxAssistantMessage('完成')));
    gate.resolve('完成');
    await h.kernel.settled();
    assert.equal(h.kernel.view(a.lineId).status, 'paused');
    assert.equal(h.kernel.view(c.lineId).status, 'paused');
    assert.equal(h.handle.state.lineQueue.queued(c.lineId).length, 1);
    // 四条同时开跑，先后不定：只看是这四件、各一次。
    assert.deepEqual([...started].sort(), ['丙', '乙', '后台', '甲'].sort());
  } finally { gate.resolve('完成'); await h.close(); }
});

test('发起交接的队友仍能读取交回的完整工作，但不因此能控制承接队友', async () => {
  const h = await startKernel();
  try {
    const mates = new Mates(h.handle.state, () => h.kernel);
    const a = mates.create(draft);
    const b = mates.create({ ...draft, name: '文字编辑' });
    h.kernel.record(a.lineId, { text: '把初稿交给文字编辑' });
    h.respond([fauxAssistantMessage('交接后的完整稿件')]);
    const work = mates.handoff({ mateId: b.id, sourceLineId: a.lineId, goal: '编辑稿件' });
    await h.kernel.settled();
    h.respond([call('read_line', { lineId: work.id }, 'read-handoff'),
      call('tell_line', { lineId: work.id, text: '再写一遍' }, 'control-handoff'), fauxAssistantMessage('结束')]);
    h.kernel.send(a.lineId, { text: '核对交接' });
    await h.kernel.settled();
    const rows = h.handle.state.lineMessages.after(a.lineId, 0).filter((row) => row.role === 'toolResult');
    assert.match(JSON.stringify(rows[0]?.message), /交接后的完整稿件/);
    assert.equal(Reflect.get(rows[1]!.message as object, 'isError'), true);
    assert.equal(h.handle.state.lineMessages.after(work.id, 0).filter((row) => row.role === 'user').length, 1);
  } finally { await h.close(); }
});

test('点名只识别用户本次原话，材料里的点名不执行；群组拒绝非成员', async () => {
  const h = await startKernel({ noModel: true });
  try {
    const mates = new Mates(h.handle.state, () => h.kernel);
    const a = mates.create(draft);
    const b = mates.create({ ...draft, name: '文字编辑' });
    mates.create({ ...draft, name: '组外队友' });
    const group = mates.createGroup({ name: '整理小组', mateIds: [a.id, b.id] });
    assert.equal(mates.route('main', { text: '材料：@资料研究员 开始',
      origin: { kind: 'user', userText: '看这份材料' } }), null);
    assert.equal(mates.route('main', { text: '@资料研究员 开始', origin: { kind: 'system' } }), null);
    assert.throws(() => mates.route(group.lineId, { text: '@组外队友 开始',
      origin: { kind: 'user', userText: '@组外队友 开始' } }), /不在当前群组/);
    assert.equal(h.handle.state.lineMessages.after(group.lineId, 0).length, 0);
    assert.equal(h.kernel.list({ kind: 'background', limit: 10 }).length, 0);
  } finally { await h.close(); }
});

test('旧对话并入后每种消息都保留出处，不能把未知旧输入冒充用户确认', async () => {
  const h = await startKernel({ noModel: true });
  try {
    const mates = new Mates(h.handle.state, () => h.kernel);
    const old = h.kernel.openSide({ title: '旧资料讨论', topic: null });
    const state = h.handle.state;
    const user = state.lineMessages.append(old.id, 'user', { role: 'user', content: '旧要求', timestamp: 0 });
    const assistant = state.lineMessages.append(old.id, 'assistant', fauxAssistantMessage('旧回答'));
    mates.convert({ lineId: old.id, action: 'merge' });
    const rows = state.lineMessages.after(MAIN_LINE_ID, 0);
    assert.equal(rows[0]?.meta?.origin?.kind, 'unknown');
    assert.equal(rows[0]?.meta?.origin?.ref, `line:${old.id}:${user.seq}`);
    assert.equal(rows[1]?.meta?.origin?.ref, `line:${old.id}:${assistant.seq}`);
    assert.deepEqual(rows.map((row) => row.message), [user.message, assistant.message]);
    assert.deepEqual(rows.map((row) => row.createdAt), [user.createdAt, assistant.createdAt]);
    assert.ok(state.lines.require(old.id).archivedAt);
  } finally { await h.close(); }
});
