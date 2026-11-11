import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { fauxAssistantMessage } from '@earendil-works/pi-ai';
import { startKernel, type Harness } from './helpers.ts';

const opened: Harness[] = [];
async function harness(): Promise<Harness> {
  const h = await startKernel();
  opened.push(h);
  return h;
}
afterEach(async () => {
  for (const h of opened.splice(0)) await h.close();
});
function paused(h: Harness, title = '已取消的工作'): string {
  const line = h.kernel.open({ title, goal: '原始要求', parentLineId: null, projectId: null }, () => undefined);
  h.kernel.halt(line.id);
  h.handle.state.lineMessages.append(line.id, 'assistant', fauxAssistantMessage('保留的原始成果'));
  return line.id;
}

test('归档四条只隐藏指定线：原话成果和撤回输入完整保留，其他工作不变', async () => {
  const h = await harness();
  const ids = Array.from({ length: 4 }, (_, i) => paused(h, `取消${i}`));
  const other = paused(h, '通用网页读取');
  const translation = paused(h, '独立翻译');
  const before = [h.kernel.read(other, 50), h.kernel.read(translation, 50)];
  const original = ids.map((id) => h.handle.state.lineMessages.page(id, null, 50));
  const queues = ids.map((id) => h.handle.state.lineQueue.queued(id));
  for (const id of ids) {
    const archived = h.kernel.archive(id);
    assert.ok(archived.archivedAt);
    assert.equal(archived.status, 'paused');
    assert.equal(archived.queued, 0);
    assert.equal(h.kernel.archive(id).archivedAt, archived.archivedAt);
  }
  assert.deepEqual(h.kernel.list({ kind: 'background', limit: 100 }).map((line) => line.id).sort(),
    [other, translation].sort());
  assert.equal(h.kernel.list({ kind: 'background', includeArchived: true, limit: 100 }).length, 6);
  assert.deepEqual([h.kernel.read(other, 50), h.kernel.read(translation, 50)], before);
  ids.forEach((id, index) => {
    assert.deepEqual(h.handle.state.lineMessages.page(id, null, 50), original[index]);
    for (const item of queues[index] ?? []) {
      const withdrawn = h.handle.state.lineQueue.get(item.id);
      assert.deepEqual(withdrawn, { ...item, status: 'withdrawn', sentSeq: null, updatedAt: withdrawn?.updatedAt });
    }
  });
});

test('归档线拒绝继续、发消息、补充和立即发送，不产生新输入或调用模型', async () => {
  const h = await harness();
  const id = paused(h);
  const queueId = h.handle.state.lineQueue.queued(id)[0]!.id;
  h.kernel.archive(id);
  assert.throws(() => h.kernel.retry(id), /归档/);
  assert.throws(() => h.kernel.send(id, { text: '不要运行' }), /归档/);
  assert.throws(() => h.kernel.tell(id, '不要运行'), /归档/);
  assert.throws(() => h.kernel.sendNow(id, queueId), /归档/);
  assert.throws(() => h.kernel.spawn(id, { title: '不应创建', goal: '不要做', projectId: null }), /归档/);
  h.kernel.start();
  await h.kernel.settled();
  assert.equal(h.kernel.view(id).status, 'paused');
  assert.equal(h.kernel.read(id, 50).queue.length, 0);
  assert.equal(h.clock.pending(), 0);
});

test('恢复只重新显示且保持暂停：撤回的旧输入不复活，明确继续才执行', async () => {
  const h = await harness();
  const id = paused(h);
  h.kernel.archive(id);
  const restored = h.kernel.restore(id);
  assert.equal(restored.archivedAt, null);
  assert.equal(restored.pauseReason, 'user');
  assert.equal(restored.status, 'paused');
  assert.equal(h.kernel.restore(id).updatedAt, restored.updatedAt);
  assert.ok(h.kernel.list({ limit: 100 }).some((line) => line.id === id));
  assert.equal(h.kernel.read(id, 50).queue.length, 0);
  h.respond([fauxAssistantMessage('明确继续后的结果')]);
  h.kernel.retry(id);
  await h.kernel.settled();
  assert.equal(h.kernel.view(id).status, 'idle');
});

test('主对话不能删除；还在做的删除时当场停下、排着的撤回，恢复后是暂停', async () => {
  const h = await harness();
  assert.throws(() => h.kernel.archive('main'), /主对话/);
  const line = h.kernel.open({ title: '排队工作', goal: '做事', parentLineId: null, projectId: null }, () => undefined);
  h.kernel.archive(line.id);
  const view = h.kernel.view(line.id);
  assert.notEqual(view.archivedAt, null);
  assert.equal(view.status, 'paused');
  assert.equal(h.kernel.read(line.id, 50).queue.length, 0);
  h.kernel.restore(line.id);
  assert.equal(h.kernel.view(line.id).pauseReason, 'user');
});

test('停止：不能再继续、不能再发消息；删除再恢复仍是停止', async () => {
  const h = await harness();
  const line = h.kernel.open({ title: '整理账单', goal: '做事', parentLineId: null, projectId: null }, () => undefined);
  h.kernel.end(line.id);
  assert.equal(h.kernel.view(line.id).outcome, 'stopped');
  assert.equal(h.kernel.read(line.id, 50).queue.length, 0);
  assert.throws(() => h.kernel.retry(line.id), /已经停止/);
  assert.throws(() => h.kernel.send(line.id, { text: '再做' }), /已经停止/);
  assert.throws(() => h.kernel.end('main'), /主对话/);
  h.kernel.archive(line.id);
  h.kernel.restore(line.id);
  assert.equal(h.kernel.view(line.id).pauseReason, 'stopped');
});

test('归档撤回和状态在同一事务，回滚不会丢失排队消息', async () => {
  const h = await harness();
  const id = paused(h);
  const before = h.kernel.read(id, 50);
  assert.throws(() => h.handle.state.transaction(() => {
    h.kernel.archive(id, () => undefined);
    throw new Error('rollback');
  }), /rollback/);
  assert.deepEqual(h.kernel.read(id, 50), before);
});

test('重启和额度定时器均不恢复归档线，撤回输入继续保留', async () => {
  const h = await harness();
  const id = paused(h);
  h.handle.state.lines.update(id, { pauseReason: 'quota', pausedUntil: '2099-01-01T00:00:00.000Z' });
  h.kernel.start();
  assert.equal(h.clock.pending(), 1);
  h.kernel.archive(id);
  assert.equal(h.clock.pending(), 0);
  await h.kernel.stop();
  const next = await startKernel({ handle: h.handle });
  opened.splice(opened.indexOf(h), 1, next);
  assert.equal(next.kernel.list({ limit: 100 }).some((line) => line.id === id), false);
  assert.equal(next.kernel.view(id).status, 'paused');
  assert.equal(next.clock.pending(), 0);
  assert.equal(next.kernel.read(id, 50).queue.length, 0);
});

test('子线结果仍保留到归档父线历史但不会重新显示或唤醒父线', async () => {
  const h = await harness();
  const parent = paused(h);
  const child = h.kernel.open({ title: '既有子线', goal: '完成后回报', parentLineId: parent,
    projectId: null, resumeParent: true }, () => undefined);
  h.kernel.halt(child.id);
  h.kernel.archive(parent);
  h.respond([fauxAssistantMessage('子线结果')]);
  h.kernel.retry(child.id);
  await h.kernel.settled();
  assert.equal(h.kernel.view(parent).status, 'paused');
  assert.ok(h.kernel.view(parent).archivedAt);
  assert.equal(h.kernel.list({ limit: 100 }).some((line) => line.id === parent), false);
  assert.ok(h.kernel.read(parent, 50).messages.some((message) => message.role === 'lineReport'));
});
