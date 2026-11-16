// 交接留在队友的对话里（11-16）：主线交给队友的话、之后插的话、队友交回的结论都在队友自己的对话里贴一份，写明谁交给谁；
// 主线照旧收到结论（带上谁交回的），接着整理后自己回用户。群组里的交接不另贴。

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fauxAssistantMessage } from '@earendil-works/pi-ai';
import type { MateDraft } from '../../shared/api/mates.ts';
import { Mates } from '../../src/mates/service.ts';
import { MAIN_LINE_ID } from '../../src/state/index.ts';
import { startKernel, until } from './helpers.ts';

const draft: MateDraft = { name: '求职顾问', role: '投递和面试准备', avatar: 'cat' as const, hue: 'sky',
  soul: '先核对页面。', purpose: null };

test('主线交给队友：交过去的话和交回的结论贴在队友对话里，主线拿到结论接着整理', async () => {
  const h = await startKernel();
  try {
    const mates = new Mates(h.handle.state, () => h.kernel);
    const mate = mates.create(draft);
    h.respond([fauxAssistantMessage('打了 3 个招呼'), fauxAssistantMessage('整理：今天发了 3 个')]);
    const child = mates.handoff({ mateId: mate.id, sourceLineId: MAIN_LINE_ID, goal: '给成都岗位打招呼' }, undefined,
      [], { resumeParent: true });
    await until(() => h.kernel.view(MAIN_LINE_ID).status === 'idle' && h.kernel.view(child.id).status === 'idle'
      && h.kernel.read(MAIN_LINE_ID, 20).messages.some((message) => message.role === 'assistant'), '主线整理完');
    const own = h.kernel.read(mate.lineId, 20).messages;
    assert.deepEqual(own.map((message) => message.role), ['handoff', 'lineReport']);
    assert.deepEqual(own[0]!.relay, { from: { kind: 'main' }, to: { kind: 'mate', id: mate.id } });
    assert.equal(own[0]!.text, '给成都岗位打招呼');
    assert.equal(own[0]!.childLineId, child.id);
    assert.deepEqual(own[1]!.relay, { from: { kind: 'mate', id: mate.id }, to: { kind: 'main' } });
    const main = h.kernel.read(MAIN_LINE_ID, 20).messages;
    const report = main.find((message) => message.role === 'lineReport')!;
    assert.deepEqual(report.relay, { from: { kind: 'mate', id: mate.id }, to: { kind: 'main' } });
    assert.equal(main.at(-1)!.text, '整理：今天发了 3 个');
    h.respond([fauxAssistantMessage('好的')]);
    h.kernel.tell(child.id, '再发两个');
    await until(() => h.kernel.read(mate.lineId, 20).messages.length === 3, '插的话也贴到队友对话');
    assert.equal(h.kernel.read(mate.lineId, 20).messages[2]!.role, 'handoff');
    await h.kernel.settled();
  } finally { await h.close(); }
});

test('群组里的交接和队友自己开的后台活不另贴', async () => {
  const h = await startKernel();
  try {
    const mates = new Mates(h.handle.state, () => h.kernel);
    const a = mates.create(draft);
    const b = mates.create({ ...draft, name: '文字编辑' });
    const group = mates.createGroup({ name: '求职小组', mateIds: [a.id, b.id] });
    h.respond([fauxAssistantMessage('组里做完'), fauxAssistantMessage('自己做完')]);
    mates.handoff({ mateId: a.id, sourceLineId: group.lineId, goal: '组里的事' });
    h.kernel.spawn(a.lineId, { title: '自己的后台活', goal: '自己做', projectId: null });
    await h.kernel.settled();
    await until(() => h.kernel.read(a.lineId, 20).messages.some((message) => message.role === 'lineReport'), '回报');
    const own = h.kernel.read(a.lineId, 20).messages;
    assert.equal(own.filter((message) => message.role === 'handoff').length, 0);
    assert.equal(own.find((message) => message.role === 'lineReport')?.relay, undefined);
  } finally { await h.close(); }
});
