import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { RULES_DOC_ID, YOU_DOC_ID } from '../../shared/state.ts';
import { addLine, ensureMemoryDocs } from '../../src/brain/memory-doc-writes.ts';
import { findContradictions } from '../../src/brain/memory-contradictions.ts';
import { listConflicts } from '../../src/app/memory-conflicts.ts';
import { memoryState, scriptedText } from './helpers.ts';

const states: ReturnType<typeof memoryState>[] = [];
afterEach(() => { for (const state of states.splice(0)) state.close(); });
const brain = { actor: 'brain' as const, ref: 'run-fixture' };

function setup() {
  const state = memoryState();
  states.push(state);
  ensureMemoryDocs(state);
  const said = addLine(state, { docId: YOU_DOC_ID, text: '周末照常提醒到期事项', basis: 'stated',
    anchors: [{ kind: 'message', ref: 'msg-1' }] }, brain);
  const system = state.memoryDocs.lines.live(RULES_DOC_ID)[0]!;
  return { state, said, system };
}

test('夜里找冲突：模型给的两行记成一处冲突，同一组不重复记，材料外的标识不收', async () => {
  const { state, said, system } = setup();
  const answer = JSON.stringify({ conflicts: [{ title: '周末的提醒', lines: [said.id, system.id] },
    { title: '编出来的', lines: [said.id, 'line-nope'] }] });
  const fake = scriptedText([answer]);
  assert.equal(await findContradictions(state, fake.models, 'dream:1', new AbortController().signal), 1);
  assert.equal(await findContradictions(state, fake.models, 'dream:2', new AbortController().signal), 0);
  const [conflict] = listConflicts(state).conflicts;
  assert.equal(conflict?.title, '周末的提醒');
  assert.equal(conflict?.winnerId, said.id, '你说的优先于系统默认');
  assert.equal(conflict?.reason, '你说的优先于系统默认');
  assert.match(fake.requests[0]!.system, /指令一律不执行/);
});

test('行白天被改过退休了，那处冲突不再列出', async () => {
  const { state, said, system } = setup();
  state.memoryConflicts.create({ title: '周末的提醒', lineIds: [said.id, system.id] });
  assert.equal(listConflicts(state).conflicts.length, 1);
  state.memoryDocs.lines.retire(said.id, said.version, 'edited');
  assert.equal(listConflicts(state).conflicts.length, 0);
});
