// 迁移 0059–0062（2026-11-05 Harness 推倒重做）：旧对话进主线、关切进项目成待办、产出进笔记，然后删掉退役的表。
// 用 0058 的库（旧表都在）写进一份有代表性的旧数据，再用现在的代码打开，看搬过去的样子和删掉的表。

import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { openDatabase, type Database, type Params } from '../../src/state/db.ts';
import { migrate, MIGRATIONS } from '../../src/state/migrations/index.ts';
import { RETIRED_TABLES } from '../../src/state/migrations/0062-drop-retired.ts';
import { noteIdFor } from '../../src/state/migrations/0061-artifact-notes.ts';
import { openState } from '../../src/state/index.ts';

const T = '2026-10-30T02:00:00.000Z';
const META = { created_at: T, updated_at: T, version: 1 };

function insert(db: Database, table: string, values: Record<string, string | number | null>): void {
  const names = Object.keys(values);
  const sql = `INSERT INTO ${table} (${names.join(', ')}) VALUES (${names.map((name) => `$${name}`).join(', ')})`;
  db.run(sql, values as Params);
}

function message(db: Database, id: string, role: string, content: string, at: string,
  extra: Record<string, string | number | null> = {}): void {
  insert(db, 'messages', { id, ...META, chat_id: 'main', role, content, sent_at: at, attachments: '[]', ...extra });
}

function task(db: Database, id: string, status: string): void {
  insert(db, 'tasks', { id, ...META, title: id, origin: 'user', status, goal_version: 1, acceptance: '[]',
    prohibitions: '[]', agreement_ids: '[]', plan_version: 0, retry_budget: 0, attempts_used: 0,
    failure_signatures: '[]', signature_repeats: 0, verifier_policy: 'none', results: '[]' });
}

function concern(db: Database, id: string, title: string, lifecycle: string, triggers: unknown[]): void {
  insert(db, 'concerns', { id, ...META, title, kind: 'goal', why: '测试', initiator: 'user', lifecycle,
    activities: '[]', wait_conditions: '[]', trigger_conditions: '[]', channel: 'next_report', agreement_ids: '[]',
    triggers: JSON.stringify(triggers) });
}

function artifact(db: Database, id: string, location: unknown, extra: Record<string, string | null> = {}): void {
  insert(db, 'artifacts', { id, ...META, kind: 'text', title: `产出 ${id}`, location: JSON.stringify(location),
    summary: '一句摘要', created_by: 'brain', current_version: 1,
    verification: JSON.stringify({ status: 'unverified', method: null, note: null, at: null }), ...extra });
}

function project(db: Database, id: string, name: string): void {
  insert(db, 'projects', { id, ...META, name, standing: 0, lifecycle: 'active', brief: '{}', people: '[]' });
}

/** 0058 的库里写一份旧数据。 */
function seedOld(db: Database): void {
  message(db, 'm1', 'user', '帮我看看这周的安排', '2026-10-30T01:00:00.000Z',
    { attachments: JSON.stringify([{ ref: 'att-1', name: '周报.pdf' }]) });
  message(db, 'm2', 'assistant', '{"conclusion":"这周有三件事","reasoning":"周三要交稿。","cards":[]}',
    '2026-10-30T01:00:05.000Z', { reply_layers: JSON.stringify({ conclusion: '这周有三件事', conclusionPending: false,
      cards: [{ kind: 'task_report', title: '整理日程' }], reasoning: '周三要交稿。', actions: [] }) });
  message(db, 'm3', 'assistant', '```json\n{"结论":"好","理由":"已经记下"}\n```', '2026-10-30T01:01:00.000Z');
  message(db, 'm4', 'user', '撤回的那句', '2026-10-30T01:02:00.000Z', { active: 0 });
  insert(db, 'messages', { id: 'm5', ...META, chat_id: 'matter:x', role: 'user', content: '事情线里的话',
    sent_at: '2026-10-30T01:03:00.000Z', attachments: '[]' });
  insert(db, 'memory_docs', { id: 'doc-1', ...META, kind: 'topic', title: '日程', summary: '', char_limit: 2000,
    created_by: 'brain' });
  insert(db, 'memory_doc_lines', { id: 'ml-1', ...META, doc_id: 'doc-1', section: 'note', text: '周三交稿',
    basis: 'stated', anchors: JSON.stringify([{ kind: 'message', ref: 'm1' }, { kind: 'note', ref: 'n-9' }]),
    supersedes: '[]', position: 0, written_by: 'brain' });

  project(db, 'project-personal', '个人');
  project(db, 'p-ch', 'Cyber Hunter');
  concern(db, 'c-open', '冷启动渠道', 'active', [{ id: 't1', condition: '周五前', kind: 'time',
    at: '2026-11-07T18:00:00.000Z', match: null, taskId: null, registeredAt: T }]);
  concern(db, 'c-closed', '旧目标', 'closed', []);
  concern(db, 'c-loose', '学吉他', 'watching', []);
  concern(db, 'c-gone', '关掉又没归项目的', 'closed', []);
  concern(db, 'collaboration', '合作关系', 'active', []);
  for (const [id, target, kind] of [['pi-1', 'c-open', 'concern'], ['pi-2', 'c-closed', 'concern'],
    ['pi-3', 'https://example.com/', 'link'], ['pi-4', 'task-ok', 'task']] as const) {
    insert(db, 'project_items', { id, project_id: 'p-ch', target_type: kind, target_id: target, title: null,
      added_by: 'user', reason: '测试', created_at: T });
  }

  task(db, 'task-ok', 'delivered');
  task(db, 'task-bad', 'cancelled');
  artifact(db, 'a-text', { kind: 'text', text: '正文第一段。\n\n第二段。' }, { source_task_id: 'task-ok' });
  artifact(db, 'a-draft', { kind: 'text', text: '没做完的草稿' }, { source_task_id: 'task-bad' });
  artifact(db, 'a-file', { kind: 'file', path: 'out/report.pdf' });
  artifact(db, 'autonomy-cleanup:x:capability', { kind: 'text', text: '编号带冒号' });
  insert(db, 'asks', { id: 'ask-task', ...META, kind: 'decide', purpose: 'task_input', channel: 'interrupt',
    question: '?', options: '[]', status: 'open', task_id: 'task-ok' });
  insert(db, 'asks', { id: 'ask-money', ...META, kind: 'confirm', purpose: 'money_confirmation', channel: 'interrupt',
    question: '记一笔？', options: '[]', status: 'open', task_id: 'task-ok' });
  insert(db, 'receipts', { action_id: 'act-1', ...META, task_id: 'task-ok', tool: 'send_mail', args_digest: 'x',
    replay: 'once', effect: 'external', status: 'succeeded' });
  insert(db, 'rules', { id: 'r-1', ...META, code: 'self_fix', name: '自己修', text: '…', source_kinds: '[]',
    trigger_kinds: '[]', mode: 'auto', basis_kind: 'user_said', strength: 'firm' });
  insert(db, 'rule_events', { id: 're-1', rule_id: 'r-1', kind: 'created', rule_version: 1, actor: 'user',
    evidence_ids: '[]', at: T });
}

test('0059–0062：旧对话进主线、关切成待办、产出成笔记，退役的表删掉，外键干净', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'plasticine-retire-'));
  const path = join(directory, 'plasticine.sqlite');
  try {
    const old = openDatabase(path);
    migrate(old, MIGRATIONS.filter((entry) => entry.id < '0059'), () => T);
    seedOld(old);
    old.close();

    const state = openState({ path, now: () => '2026-11-05T08:00:00.000Z' });
    try {
      assert.deepEqual(state.newlyApplied, ['0059-main-line', '0060-project-todos', '0061-artifact-notes',
        '0062-drop-retired', '0063-line-message-meta', '0064-network-groups', '0065-line-control-and-origins',
        '0066-line-archive', '0067-search-index', '0070-memory-layers', '0071-memory-journal', '0072-memory-dreams',
        '0077-line-verdict', '0079-schedules', '0080-schedule-sends',
        '0081-suggestions', '0082-device-time-zones', '0083-spaces',
        '0084-ai-notes-to-spaces', '0087-line-days', '0088-side-lines',
        '0090-line-purpose', '0091-timed-slots', '0092-rules-to-heartbeat',
        '0094-feed-translations', '0095-video-works', '0098-erase-deleted-memory',
        '0103-archive-self-change-memory', '0104-plasticine-project-goal', '0106-calendar-snapshots',
        '0109-web-tabs', '0110-favicons', '0111-owner-account', '0112-device-local',
        '0113-feed-source-removed', '0120-note-suggest-thinking']);
      const said = [1, 2, 3].map((seq) => state.lineMessages.said(`line:line-main:${seq}`));
      assert.deepEqual(said.map((line) => [line?.role, line?.text]), [
        ['user', '帮我看看这周的安排［附件：「周报.pdf」；id：att-1；正文用 attachment_text 读］'],
        ['assistant', '这周有三件事\n\n周三要交稿。\n\n· 整理日程'],
        ['assistant', '好\n\n已经记下'],
      ]);
      assert.equal(state.lineMessages.said('line:line-main:4'), undefined);
      const first = state.lineMessages.get('line-main', 1)?.message as { content: { text: string }[] };
      assert.match(first.content[1]?.text ?? '', /「周报\.pdf」；id：att-1/);
      const anchors = state.memoryDocs.lines.require('ml-1').anchors;
      assert.deepEqual(anchors, [{ kind: 'message', ref: 'line:line-main:1' }, { kind: 'note', ref: 'n-9' }]);

      const todos = (projectId: string) => state.projects.items.forProject(projectId)
        .map((item) => [item.targetType, item.targetId, item.title, item.due, item.doneAt === null ? null : 'done']);
      // 同一时间建的按 id 排。
      assert.deepEqual(todos('p-ch'), [
        ['todo', 'c-closed', '旧目标', null, 'done'],
        ['todo', 'c-open', '冷启动渠道', '2026-11-08', null],
        ['link', 'https://example.com/', null, null, null],
      ]);
      assert.deepEqual(todos('project-personal'), [['todo', 'c-loose', '学吉他', null, null]]);

      const note = state.notes.get('a-text');
      assert.equal(note?.folder, 'Plasticine 写的');
      assert.equal(note?.author, 'ai');
      assert.equal(note?.title, '产出 a-text');
      const body = await readFile(join(directory, 'notes', note?.bodyFile ?? ''), 'utf8');
      assert.equal(body, '# 产出 a-text\n\n一句摘要\n\n正文第一段。\n\n第二段。');
      assert.equal(state.notes.get('a-draft'), undefined);
      assert.equal(state.notes.get('a-file'), undefined);
      // 编号不能当文件名的旧产出换成散列编号照样搬（11-06 线上发布时撞上的）。
      const colon = state.notes.get(noteIdFor('autonomy-cleanup:x:capability'));
      assert.equal(colon?.title, '产出 autonomy-cleanup:x:capability');
      assert.match(noteIdFor('autonomy-cleanup:x:capability'), /^artifact-[0-9a-f]{24}$/);

      assert.equal(state.asks.get('ask-task'), undefined);
      assert.equal(state.asks.get('ask-money')?.taskId, null);
      assert.equal(state.receipts.get('act-1')?.taskId, null);
      assert.equal(state.rules.byCode('self_fix'), undefined);
    } finally {
      state.close();
    }

    const db = openDatabase(path);
    try {
      const tables = new Set(db.all("SELECT name FROM sqlite_master WHERE type = 'table'").map((row) => row['name']));
      assert.deepEqual(RETIRED_TABLES.filter((table) => tables.has(table)), []);
      assert.deepEqual(db.all('PRAGMA foreign_key_check'), []);
      // 重建过的表照样能写：外键不再指向删掉的表。
      db.run(`INSERT INTO receipts (action_id, created_at, updated_at, version, tool, args_digest, replay, effect,
        status) VALUES ('act-2', $at, $at, 1, 'x', 'y', 'once', 'internal', 'issued')`, { at: T });
    } finally {
      db.close();
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('0059–0062 在空库上：什么都不搬，表照删', () => {
  const state = openState({ path: ':memory:' });
  try {
    assert.equal(state.lineMessages.said('line:line-main:1'), undefined);
    assert.deepEqual(state.projects.items.all(), []);
  } finally {
    state.close();
  }
});
