import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';
import { YOU_DOC_ID } from '../../../shared/state.ts';
import { addLine, ensureMemoryDocs } from '../../../src/brain/memory-doc-writes.ts';
import { createMemoryDocTools } from '../../../src/brain/tools/memory-docs.ts';
import type { Tool, ToolContext } from '../../../src/brain/tools/registry.ts';
import type { StateService } from '../../../src/state/index.ts';
import { FIXED_NOW, memoryState } from '../helpers.ts';

let state: StateService;

beforeEach(() => {
  state = memoryState();
  ensureMemoryDocs(state);
});

afterEach(() => {
  state.close();
});

function context(): ToolContext {
  return { signal: new AbortController().signal, runId: 'run-1', callId: 'call-1', actionId: null,
    now: () => FIXED_NOW };
}

function tool(name: string): Tool {
  const found = createMemoryDocTools(state).find((item) => item.name === name);
  assert.ok(found !== undefined, name);
  return found;
}

const writer = { actor: 'brain' as const, ref: 'job-1' };
const anchors = [{ kind: 'message' as const, ref: 'msg-1' }];

test('两个工具都只读、可并行，验收轮也能用', () => {
  for (const name of ['read_memory_doc', 'search_memory']) {
    assert.equal(tool(name).effect, 'read');
    assert.equal(tool(name).parallel, true);
    assert.ok(tool(name).roles.includes('verifier'));
  }
});

test('读一篇记忆：按名字读（也认标识），在用的行带锚点，要时带上归档；没有的说清怎么找', async () => {
  const home = addLine(state, { docId: YOU_DOC_ID, text: '住在杭州', basis: 'stated', anchors }, writer);
  state.memoryDocs.lines.retire(home.id, home.version, 'revised');
  addLine(state, { docId: YOU_DOC_ID, text: '住在重庆', basis: 'stated', anchors }, writer);
  const read = JSON.parse(await tool('read_memory_doc').execute({ name: '关于你', includeRetired: true },
    context())) as { lines: { text: string; anchors: unknown }[]; archived: { text: string }[] };
  assert.deepEqual(read.lines.map((line) => line.text), ['住在重庆']);
  assert.deepEqual(read.lines[0]?.anchors, anchors);
  assert.deepEqual(read.archived.map((line) => line.text), ['住在杭州']);
  const byId = JSON.parse(await tool('read_memory_doc').execute({ docId: YOU_DOC_ID }, context())) as { id: string };
  assert.equal(byId.id, YOU_DOC_ID);
  await assert.rejects(tool('read_memory_doc').execute({ docId: 'memdoc-404' }, context()), /search_memory/);
});

test('搜记忆返回行所在的文档名字和行标识；归档的只在 archive 时出现并标出来', async () => {
  const line = addLine(state, { docId: YOU_DOC_ID, text: '在学吉他，报了一个周末班', basis: 'stated', anchors },
    writer);
  const old = addLine(state, { docId: YOU_DOC_ID, text: '在学吉他，还没有报班', basis: 'stated', anchors }, writer);
  state.memoryDocs.lines.retire(old.id, old.version, 'no_longer_true');
  const hits = JSON.parse(await tool('search_memory').execute({ query: '学吉他' }, context())) as
    { doc: string; lineId: string; archived: boolean }[];
  assert.deepEqual(hits.map((hit) => [hit.doc, hit.lineId, hit.archived]), [['关于你', line.id, false]]);
  const all = JSON.parse(await tool('search_memory').execute({ query: '学吉他', archive: true }, context())) as
    { lineId: string; archived: boolean }[];
  assert.deepEqual(all.filter((hit) => hit.archived).map((hit) => hit.lineId), [old.id]);
});
