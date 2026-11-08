import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';
import { openTestState, throwsState, type TestState } from './helpers.ts';

let t: TestState;

beforeEach(async () => {
  t = await openTestState();
});

afterEach(async () => {
  await t.cleanup();
});

test('新建项目：没写的字段取默认，档案四栏是空字符串，读回来一模一样', () => {
  const created = t.state.projects.create({ name: 'Cyber Hunter' });
  assert.equal(created.version, 1);
  assert.equal(created.lifecycle, 'active');
  assert.equal(created.standing, false);
  assert.equal(created.health, null);
  assert.equal(created.proposedHealth, null);
  assert.deepEqual(created.brief, { goal: '', constraints: '', rules: '', terms: '' });
  assert.deepEqual(created.people, []);
  assert.deepEqual(t.state.projects.get(created.id), created);
});

test('截止只收年月日，健康度只收三档，多出未知字段拒绝写入', () => {
  throwsState(() => t.state.projects.create({ name: '西部妇幼', due: '11月5日' }), 'invalid_input');
  throwsState(() => t.state.projects.create({ name: '西部妇幼', health: 'great' as 'ok' }), 'invalid_input');
  const extra = { name: '西部妇幼', priority: 1 } as unknown as { name: string };
  throwsState(() => t.state.projects.create(extra), 'invalid_input');
  const ok = t.state.projects.create({ name: '西部妇幼', due: '2026-11-20' });
  assert.equal(ok.due, '2026-11-20');
});

test('改项目带对的版本号成功，过时的版本号报冲突', () => {
  const created = t.state.projects.create({ name: '个人' });
  const proposed = { value: 'risk' as const, reason: '登记速度跟不上', at: '2026-11-01T08:12:00.000Z' };
  const updated = t.state.projects.update(created.id, 1, { proposedHealth: proposed, next: '发今天的采访' });
  assert.equal(updated.version, 2);
  assert.deepEqual(updated.proposedHealth, proposed);
  throwsState(() => t.state.projects.update(created.id, 1, { next: '别的' }), 'version_conflict');
});

test('归档：一样东西只属于一个项目，再归一次就挪到新项目；拿出来不动东西本身', () => {
  const a = t.state.projects.create({ name: 'A' });
  const b = t.state.projects.create({ name: 'B' });
  const note = t.state.notes.create({ markdown: '# 周报', author: 'user', folder: '笔记' });
  const base = { targetType: 'note' as const, targetId: note.id, addedBy: 'brain' as const };
  t.state.projects.items.file({ ...base, projectId: a.id, reason: '标题里写着 A' });
  assert.equal(t.state.projects.items.forProject(a.id).length, 1);
  const moved = t.state.projects.items.file({ ...base, projectId: b.id, addedBy: 'user', reason: '你挪过来的' });
  assert.equal(moved.projectId, b.id);
  assert.equal(moved.addedBy, 'user');
  assert.equal(t.state.projects.items.forProject(a.id).length, 0);
  assert.equal(t.state.projects.items.unfile('note', note.id), true);
  assert.equal(t.state.projects.items.find('note', note.id), undefined);
  assert.notEqual(t.state.notes.get(note.id), undefined);
});

test('待办：加一条（id 就是 target_id），改期限、勾掉；不是待办的不能当待办改；期限只收年月日', () => {
  const p = t.state.projects.create({ name: '个人' });
  const todo = t.state.projects.items.addTodo({ projectId: p.id, title: '交房租', due: '2026-11-10', addedBy: 'user',
    reason: '你加的' });
  assert.equal(todo.targetId, todo.id);
  assert.equal(todo.doneAt, null);
  const moved = t.state.projects.items.editTodo(todo.id, { due: '2026-11-12' });
  assert.equal(moved?.due, '2026-11-12');
  const done = t.state.projects.items.editTodo(todo.id, { doneAt: '2026-11-05T08:00:00.000Z' });
  assert.equal(done?.doneAt, '2026-11-05T08:00:00.000Z');
  throwsState(() => t.state.projects.items.editTodo(todo.id, { due: '11月12日' }), 'invalid_input');
  const url = 'https://example.com/';
  const link = t.state.projects.items.file({ projectId: p.id, targetType: 'link', targetId: url, addedBy: 'user',
    reason: '资料' });
  assert.equal(t.state.projects.items.editTodo(link.id, { title: '不是待办' }), undefined);
  throwsState(() => t.state.projects.items.file({ projectId: p.id, targetType: 'link', targetId: 'https://a.example/',
    addedBy: 'user', reason: '资料', due: '2026-11-10' }), 'invalid_input');
  assert.equal(t.state.projects.items.unfile('todo', todo.id), true);
});

test('链接直接用地址当 target_id，带标题', () => {
  const p = t.state.projects.create({ name: 'Cyber Hunter' });
  const url = 'https://github.com/example/plasticine';
  t.state.projects.items.file({ projectId: p.id, targetType: 'link', targetId: url, title: 'GitHub · plasticine',
    addedBy: 'user', reason: '你加的资料' });
  assert.equal(t.state.projects.items.find('link', url)?.title, 'GitHub · plasticine');
});

test('项目动态只追加，最近的在前，按条数截', () => {
  const p = t.state.projects.create({ name: 'Plasticine' });
  t.state.projects.events.add({ projectId: p.id, kind: 'created', text: '建了项目', actor: 'system' });
  t.state.projects.events.add({ projectId: p.id, kind: 'health', text: '健康度 顺利', actor: 'user', actorRef: 'd1' });
  const recent = t.state.projects.events.recent(p.id, 1);
  assert.equal(recent.length, 1);
  assert.equal(recent[0]?.kind, 'health');
  assert.equal(recent[0]?.actorRef, 'd1');
  throwsState(() => t.state.projects.events.add({ projectId: p.id, kind: 'oops' as 'created', text: 'x',
    actor: 'user' }), 'invalid_input');
});
