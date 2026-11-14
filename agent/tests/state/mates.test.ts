import assert from 'node:assert/strict';
import { test } from 'node:test';
import { openTestState } from './helpers.ts';

test('队友和群组分别保存身份及对话线，停用保留全部数据，群组只接受二至六位不同成员', async () => {
  const fixture = await openTestState();
  try {
    const { state } = fixture;
    const line = state.lines.create({ kind: 'side', parentLineId: null, projectId: null, title: '研究队友' });
    const draft = { name: '研究队友', avatar: 'cat' as const, hue: 'sky' as const, role: '梳理材料', soul: '先查原文',
      purpose: null, lineId: line.id };
    const mate = state.mates.create(draft);
    state.lines.update(line.id, { mateId: mate.id });
    assert.equal(state.lines.require(line.id).mateId, mate.id);
    const second = state.mates.create({ ...draft, name: '写作队友', lineId: state.lines.create({ kind: 'side',
      parentLineId: null, projectId: null, title: '写作队友' }).id });
    const groupLine = state.lines.create({ kind: 'side', parentLineId: null, projectId: null, title: '资料小组' });
    const group = state.mateGroups.create({ name: '资料小组', mateIds: [mate.id, second.id], lineId: groupLine.id });
    assert.deepEqual(state.mateGroups.get(group.id)?.mateIds, [mate.id, second.id]);
    state.mates.update(mate.id, mate.version, { disabledAt: '2026-11-11T00:00:00.000Z' });
    assert.equal(state.mates.active().length, 1);
    assert.equal(state.mates.require(mate.id).soul, '先查原文');
    assert.throws(() => state.mateGroups.create({ name: '重复小组', mateIds: [second.id, second.id],
      lineId: groupLine.id }));
  } finally { await fixture.cleanup(); }
});

test('队友的画风和脸型：不给就是扁平、萌脸，改了存下来，不认识的不收', async () => {
  const fixture = await openTestState();
  try {
    const { state } = fixture;
    const line = state.lines.create({ kind: 'side', parentLineId: null, projectId: null, title: '设计队友' });
    const mate = state.mates.create({ name: '设计队友', avatar: 'fox', hue: 'rose', role: '画界面', soul: '',
      purpose: null, lineId: line.id });
    assert.equal(mate.variant, 'solid');
    assert.equal(mate.face, 'cute');
    const changed = state.mates.update(mate.id, mate.version, { variant: 'watercolor', face: 'sparkle' });
    assert.deepEqual([changed.variant, changed.face], ['watercolor', 'sparkle']);
    assert.deepEqual([state.mates.require(mate.id).variant, state.mates.require(mate.id).face],
      ['watercolor', 'sparkle']);
    assert.throws(() => state.mates.update(mate.id, changed.version, { variant: 'crisp' as 'solid' }));
  } finally { await fixture.cleanup(); }
});
