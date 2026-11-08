import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';
import { STANDING_PROJECT_IDS } from '../../../shared/state.ts';
import { ensureDefaultProjects } from '../../../src/brain/default-projects.ts';
import { projectOverview, projectTools } from '../../../src/brain/tools/projects.ts';
import type { Tool, ToolContext } from '../../../src/brain/tools/registry.ts';
import { openTestState, type TestState } from '../../state/helpers.ts';
import { FIXED_NOW } from '../helpers.ts';

let t: TestState;
let changed: string[];

beforeEach(async () => {
  t = await openTestState();
  ensureDefaultProjects(t.state);
  changed = [];
});

afterEach(async () => {
  await t.cleanup();
});

function context(actionId: string | null = null): ToolContext {
  const signal = new AbortController().signal;
  return { signal, runId: 'run-1', callId: 'call-1', actionId, now: () => FIXED_NOW };
}

function tool(name: string): Tool {
  const found = projectTools({ state: t.state, changed: (id) => changed.push(id) })
    .find((item) => item.name === name);
  assert.ok(found !== undefined, name);
  return found;
}

/** 他在主线上说的一句，按 line:<线>:<seq> 认。 */
function userSays(content: string): { id: string } {
  const lineId = t.state.lines.main().id;
  const row = t.state.lineMessages.append(lineId, 'user', { role: 'user', content, timestamp: 0 });
  return { id: `line:${lineId}:${row.seq}` };
}

async function run(name: string, args: Record<string, unknown>, actionId: string | null = null): Promise<unknown> {
  return JSON.parse(await tool(name).execute(args, context(actionId)));
}

test('读工具只读、可并行；写工具只放行一次，健康度只能提议', () => {
  assert.equal(tool('list_projects').effect, 'read');
  assert.equal(tool('read_project').parallel, true);
  assert.equal(tool('update_project').replay, 'once');
  const params = JSON.stringify(tool('update_project').parameters);
  assert.match(params, /proposeHealth/);
  assert.doesNotMatch(params, /"health"/);
});

test('建项目：同一个动作重放只建一个，动态记成 Plasticine 写的', async () => {
  const first = await run('create_project', { name: 'Cyber Hunter', due: '2026-11-05', why: '你说要单独管' }, 'a1');
  const again = await run('create_project', { name: 'Cyber Hunter', why: '你说要单独管' }, 'a1');
  assert.deepEqual(first, again);
  assert.equal(t.state.projects.all().length, 3);
  const id = (first as { id: string }).id;
  assert.equal(t.state.projects.events.recent(id, 5)[0]?.actor, 'brain');
  assert.deepEqual(changed, [id]);
});

test('AI 写入后通知对应项目；资料跨项目移动通知原归属，失败不通知', async () => {
  const first = STANDING_PROJECT_IDS.personal;
  const second = STANDING_PROJECT_IDS.plasticine;
  await run('update_project', { projectId: first, next: '下一步核对资料' });
  assert.deepEqual(changed.splice(0), [first]);
  const targetId = 'https://example.test/project-material';
  await run('file_to_project', { projectId: first, targetType: 'link', targetId, reason: '项目资料' });
  assert.deepEqual(changed.splice(0), [first]);
  await run('file_to_project', { projectId: second, targetType: 'link', targetId, reason: '改归这个项目' });
  assert.deepEqual(new Set(changed.splice(0)), new Set([first, second]));
  const todo = await run('file_to_project', { projectId: second, targetType: 'todo', targetId: 'new',
    title: '核对归属', reason: '待确认' }) as { todoId: string };
  assert.deepEqual(changed.splice(0), [second]);
  await run('edit_project_todo', { todoId: todo.todoId, done: true });
  assert.deepEqual(changed.splice(0), [second]);
  const said = userSays('这个项目先做资料核对');
  await run('file_to_project', { projectId: second, targetType: 'decision', targetId: said.id,
    text: '先做资料核对', reason: '用户明确决定' });
  assert.deepEqual(changed.splice(0), [second]);
  await assert.rejects(tool('file_to_project').execute({ projectId: second, targetType: 'note',
    targetId: 'missing-note', reason: '不存在' }, context()));
  assert.deepEqual(changed, []);
});

test('更新项目：现状记成 Plasticine 写的，提议健康度不碰用户确认的那一列', async () => {
  const id = STANDING_PROJECT_IDS.plasticine;
  await run('update_project', { projectId: id, status: '审查 16 条做完 11 条',
    proposeHealth: { value: 'risk', reason: '还有 5 条' }, brief: { rules: '先出设计再上线' } });
  const project = t.state.projects.require(id);
  assert.equal(project.status?.by, 'brain');
  assert.equal(project.proposedHealth?.value, 'risk');
  assert.equal(project.health, null);
  assert.equal(project.brief.rules, '先出设计再上线');
  assert.match(project.brief.goal, /Plasticine 自己/);
  const texts = t.state.projects.events.recent(id, 5).map((event) => event.text);
  assert.ok(texts.some((text) => text.includes('提议健康度「有风险」')));
});

test('待办：归档成待办带期限，勾掉；链接要完整地址；读项目带上档案和待办', async () => {
  const personal = STANDING_PROJECT_IDS.personal;
  const added = await run('file_to_project', { projectId: personal, targetType: 'todo', targetId: 'new',
    title: '交房租', due: '2026-11-10', reason: '你说月初要交' }) as { todoId: string };
  await assert.rejects(tool('file_to_project').execute({ projectId: personal, targetType: 'todo', targetId: 'new',
    reason: '没写要做什么' }, context()), /title/);
  const done = await run('edit_project_todo', { todoId: added.todoId, done: true }) as { done: boolean };
  assert.equal(done.done, true);
  await assert.rejects(tool('file_to_project').execute({ projectId: personal, targetType: 'link',
    targetId: 'ftp://x', reason: '资料' }, context()), /http/);
  const read = await run('read_project', { projectId: personal }) as { todos: { id: string; due: string;
    done: boolean }[]; brief: unknown };
  assert.deepEqual(read.todos.map((todo) => [todo.id, todo.due, todo.done]), [[added.todoId, '2026-11-10', true]]);
  assert.ok(read.brief !== undefined);
});

test('项目一览进系统提示：有现状和下一步，完成的不列', async () => {
  const id = STANDING_PROJECT_IDS.plasticine;
  const project = t.state.projects.require(id);
  t.state.projects.update(id, project.version, { next: '看项目页' });
  const done = t.state.projects.create({ name: '旧事', lifecycle: 'done' });
  const overview = projectOverview(t.state);
  assert.match(overview, /## 项目/);
  assert.match(overview, /下一步：看项目页/);
  assert.doesNotMatch(overview, new RegExp(done.name));
});

test('决定进项目档案：写进项目文档的决定段并链回用户消息；同一件事不再加；改一条留之前；读项目带上', async () => {
  const id = STANDING_PROJECT_IDS.plasticine;
  const said = userSays('记忆页先不做界面，只做后台');
  const filed = await run('file_to_project', { projectId: id, targetType: 'decision', targetId: said.id,
    text: '记忆页界面放下一批，这次只做后台和 API', reason: '你在主线里定的' }) as { lineId: string; docId: string };
  const again = await run('file_to_project', { projectId: id, targetType: 'decision', targetId: said.id,
    text: '记忆页界面放下一批，这次只做后台和 API。', reason: '又说了一遍' }) as { alreadyFiled?: boolean };
  assert.equal(again.alreadyFiled, true);
  const line = t.state.memoryDocs.lines.require(filed.lineId);
  assert.equal(line.section, 'decision');
  assert.deepEqual(line.anchors, [{ kind: 'message', ref: said.id }]);
  const later = userSays('界面这批也做吧');
  const revised = await run('file_to_project', { projectId: id, targetType: 'decision', targetId: later.id,
    text: '记忆页界面这批一起做', replacesLineId: filed.lineId, reason: '你改了主意' }) as { lineId: string };
  assert.equal(t.state.memoryDocs.lines.require(revised.lineId).previous, '记忆页界面放下一批，这次只做后台和 API');
  const read = await run('read_project', { projectId: id }) as { memory: { decisions: { text: string }[] } };
  assert.deepEqual(read.memory.decisions.map((item) => item.text), ['记忆页界面这批一起做']);
  const texts = t.state.projects.events.recent(id, 5).map((event) => event.text);
  assert.ok(texts.some((text) => text.startsWith('改了决定：记忆页界面这批一起做')));
  await assert.rejects(tool('file_to_project').execute({ projectId: id, targetType: 'decision',
    targetId: 'not-a-message', text: '编的', reason: '没有原话' }, context()), /用户说定/);
  await assert.rejects(tool('file_to_project').execute({ projectId: id, targetType: 'decision', targetId: said.id,
    reason: '没写决定' }, context()), /text/);
});
