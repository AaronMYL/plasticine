import assert from 'node:assert/strict';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, test } from 'node:test';
import { ServerCommands } from '../../src/cloud-tools/server-command.ts';
import { tempDirectory } from '../state/helpers.ts';

let dir: Awaited<ReturnType<typeof tempDirectory>>;
beforeEach(async () => { dir = await tempDirectory(); });
afterEach(async () => { await dir.cleanup(); });
const identity = { actionId: 'task-1:step:g0:server_exec:hash', runId: 'run-1', taskId: 'task-1' };
const signal = new AbortController().signal;
const store = () => new ServerCommands({ stateDirectory: dir.directory, cwd: dir.directory });

test('server command keeps stable ID and real exit status; recovery replay never executes twice', async () => {
  const commands = store();
  const request = { script: 'printf x >> count; printf "结果🙂"; printf problem >&2; exit 7' };
  const first = await commands.execute(request, identity, signal);
  assert.equal(first.status, 'completed');
  assert.equal(first.exitCode, 7);
  assert.equal(commands.read(first.id, 'stdout').text, '结果🙂');
  assert.equal(commands.read(first.id, 'stderr').text, 'problem');
  const replay = await store().execute(request, { ...identity, runId: 'run-resumed' }, signal);
  assert.equal(replay.id, first.id);
  assert.equal(replay.reused, true);
  assert.equal(readFileSync(join(dir.directory, 'count'), 'utf8'), 'x');
  await assert.rejects(store().execute({ script: 'printf changed >> count' }, identity, signal), /不同/);
});

test('retains full long output and paginates by Unicode chars across restart without splitting', async () => {
  const commands = store();
  const text = '结果🙂\n'.repeat(7_000);
  writeFileSync(join(dir.directory, 'input'), text);
  const result = await commands.execute({ script: 'cat input' }, identity, signal);
  const resumed = store();
  let all = '';
  let offset = 0;
  for (;;) {
    const page = resumed.read(result.id, 'stdout', offset, 997);
    all += page.text;
    if (page.nextOffset === null) { break; }
    offset = page.nextOffset;
  }
  assert.equal(all, text);
  assert.ok(result.stdoutBytes > 10_000);
  assert.equal(resumed.list('task-1')[0]?.id, result.id);
  assert.equal(resumed.list('other').length, 0);
});

test('timeout stops command and descendants while preserving captured output and final state', async () => {
  const commands = store();
  const result = await commands.execute({
    script: 'printf started; (sleep 0.5; printf escaped > escaped) & wait', timeoutMs: 80,
  }, identity, signal);
  assert.equal(result.status, 'timed_out');
  assert.equal(commands.read(result.id, 'stdout').text, 'started');
  await new Promise((resolve) => setTimeout(resolve, 650));
  assert.equal(existsSync(join(dir.directory, 'escaped')), false);
  assert.equal(commands.verify(identity.actionId).outcome, 'happened');
});

test('cancel kills process group; cancelling before launch creates no execution placeholder', async () => {
  const commands = store();
  const cancelled = new AbortController();
  cancelled.abort();
  await assert.rejects(commands.execute({ script: 'touch forbidden' }, identity, cancelled.signal), /取消/);
  assert.equal(commands.list().length, 0);
  const abort = new AbortController();
  const pending = commands.execute({ script: 'printf started; sleep 30' }, identity, abort.signal);
  setTimeout(() => abort.abort(), 70);
  const result = await pending;
  assert.equal(result.status, 'cancelled');
  assert.equal(commands.read(result.id, 'stdout').text, 'started');
});

test('interrupted command stays unknown and readable without blindly re-running action', async () => {
  const commands = store();
  const result = await commands.execute({ script: 'printf x >> count' }, identity, signal);
  const path = join(dir.directory, 'server-commands', result.id, 'command.json');
  const interrupted = { ...JSON.parse(readFileSync(path, 'utf8')), status: 'running', finishedAt: null,
    exitCode: null };
  writeFileSync(path, JSON.stringify(interrupted));
  const resumed = store();
  const previous = await resumed.execute({ script: 'printf x >> count' }, identity, signal);
  assert.equal(previous.status, 'unknown');
  assert.equal(resumed.verify(identity.actionId).outcome, 'unknown');
  assert.equal(resumed.read(result.id).command.status, 'unknown');
  assert.equal(readFileSync(join(dir.directory, 'count'), 'utf8'), 'x');
});

test('defaults cwd to app user\'s home directory rather than install directory', async () => {
  const commands = new ServerCommands({ stateDirectory: dir.directory });
  const result = await commands.execute({ script: 'pwd' }, { ...identity, actionId: `${identity.actionId}:home` },
    signal);
  assert.equal(result.cwd, homedir());
  assert.notEqual(result.cwd, process.cwd());
});
