// 第 115 条：维护入口命令行。参数变成一条维护命令；db.read 只读打开库、只收查询；连不上服务时说清是入口没开。

import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { parseMaintArgs, readDatabase, sendMaintenance } from './maint.ts';

const NOW = new Date('2026-11-04T10:00:00.000Z');

test('归档系统来信：带原话和操作号；状态目录默认线上那个', () => {
  const parsed = parseMaintArgs(['inbox.archive', '--sources', 'patrol, feedback', '--because', '旧的巡查报告收起来',
    '--op-id', 'op-2026-11-04-archive'], {}, NOW);
  assert.equal(parsed.kind, 'socket');
  assert.equal(parsed.stateDir, '/home/plasticine/state/agent');
  assert.deepEqual(parsed.request, { operationId: 'op-2026-11-04-archive', op: 'inbox.archive',
    because: '旧的巡查报告收起来', sources: ['patrol', 'feedback'] });
});

test('没给操作号就生成一个；PLASTICINE_STATE 改状态目录；退役的规则命令和选项不再认', () => {
  const parsed = parseMaintArgs(['inbox.archive', '--sources', 'patrol', '--because', '收起来'],
    { PLASTICINE_STATE: '/tmp/state' }, NOW);
  assert.equal(parsed.stateDir, '/tmp/state');
  assert.match(parsed.request?.operationId ?? '', /^maint-20261104100000-[a-z0-9]+$/);
  assert.throws(() => parseMaintArgs(['rules.mode', '--because', '关掉'], {}, NOW), /不认识的命令/);
  assert.throws(() => parseMaintArgs(['rules.list'], {}, NOW), /不认识的命令/);
  assert.throws(() => parseMaintArgs(['status', '--code', 'feed_interest'], {}, NOW), /--code/);
  assert.throws(() => parseMaintArgs(['drop'], {}, NOW), /不认识的命令/);
});

test('mail.refetch：--limit 是这次补几封（1 到 200 的整数），带原话', () => {
  const parsed = parseMaintArgs(['mail.refetch', '--limit', '50', '--because', '从 Gmail 重新抓回补齐格式，合并重复',
    '--op-id', 'op-mail-1'], {}, NOW);
  assert.deepEqual(parsed.request, { operationId: 'op-mail-1', op: 'mail.refetch',
    because: '从 Gmail 重新抓回补齐格式，合并重复', limit: 50 });
  assert.throws(() => parseMaintArgs(['mail.refetch', '--limit', '0'], {}, NOW), /--limit/);
  assert.throws(() => parseMaintArgs(['mail.refetch', '--limit', '201'], {}, NOW), /--limit/);
  assert.throws(() => parseMaintArgs(['mail.refetch', '--limit', '五十'], {}, NOW), /--limit/);
});

test('memory.layers：--plan 是一个对象 {"moves":[…]}，至少一行', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'maint-layers-'));
  try {
    const plan = join(dir, 'plan.json');
    const moves = [{ lineId: 'line-1', version: 1, toDocId: 'memdoc-proactive', section: 'never' }];
    await writeFile(plan, JSON.stringify({ moves }));
    const parsed = parseMaintArgs(['memory.layers', '--plan', plan, '--because', '记忆搬家同意你做',
      '--op-id', 'layers-1'], {}, NOW);
    assert.deepEqual(parsed.request, { operationId: 'layers-1', op: 'memory.layers', because: '记忆搬家同意你做',
      moves });
    await writeFile(plan, JSON.stringify({ moves: [] }));
    assert.throws(() => parseMaintArgs(['memory.layers', '--plan', plan], {}, NOW), /至少一行/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('db.read：只读打开库查一句；写语句和不是查询的开头都拒绝', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'plasticine-maint-cli-'));
  try {
    const db = new DatabaseSync(join(directory, 'plasticine.sqlite'));
    db.exec("CREATE TABLE tasks (id TEXT, status TEXT); INSERT INTO tasks VALUES ('t1', 'queued')");
    db.close();
    const parsed = parseMaintArgs(['db.read', 'SELECT', 'id,', 'status', 'FROM', 'tasks', '--state', directory]);
    assert.equal(parsed.kind, 'db.read');
    assert.deepEqual(readDatabase(directory, parsed.sql!).map((row) => ({ ...(row as object) })),
      [{ id: 't1', status: 'queued' }]);
    assert.throws(() => parseMaintArgs(['db.read', "UPDATE tasks SET status = 'x'"]), /只收 SELECT/);
    assert.throws(() => readDatabase(directory, "WITH x AS (SELECT 1) INSERT INTO tasks VALUES ('t2', 'q')"),
      /readonly|read-only|只读/i);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('服务没开时说清是维护入口没开', async () => {
  await assert.rejects(() => sendMaintenance('/tmp/plasticine-no-such.sock',
    { operationId: 'op-x', op: 'status' }), /维护入口没开/);
});
