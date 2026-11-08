import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { test } from 'node:test';
import { stopOnStdinEof, stopSignal } from '../../src/app/stop-signal.ts';

function fakeProcess(): EventEmitter & Pick<NodeJS.Process, 'once'> {
  return new EventEmitter() as EventEmitter & Pick<NodeJS.Process, 'once'>;
}

test('SIGTERM 到了就收尾', async () => {
  const proc = fakeProcess();
  const stopped = stopSignal({ process: proc });
  proc.emit('SIGTERM');
  assert.equal(await stopped, 'SIGTERM');
});

test('看护进程关掉 stdin 就收尾（Windows 没有 SIGTERM 可发）', async () => {
  const proc = fakeProcess();
  const stdin = new PassThrough();
  const stopped = stopSignal({ process: proc, stdin });
  stdin.write('任何内容都只读走\n');
  stdin.end();
  assert.equal(await stopped, 'stdin_closed');
});

test('只有 PLASTICINE_STOP_ON_STDIN_EOF=1 才听 stdin（systemd 下 stdin 一开就是 EOF）', () => {
  assert.equal(stopOnStdinEof({ PLASTICINE_STOP_ON_STDIN_EOF: '1' }), true);
  assert.equal(stopOnStdinEof({}), false);
  assert.equal(stopOnStdinEof({ PLASTICINE_STOP_ON_STDIN_EOF: '0' }), false);
});
