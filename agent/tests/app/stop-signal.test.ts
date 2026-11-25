import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { test } from 'node:test';
import { stopOnStdinEof, stopSignal } from '../../src/app/stop-signal.ts';

function fakeProcess(): EventEmitter & Pick<NodeJS.Process, 'once'> {
  return new EventEmitter() as EventEmitter & Pick<NodeJS.Process, 'once'>;
}

test('shuts down cleanly on SIGTERM', async () => {
  const proc = fakeProcess();
  const stopped = stopSignal({ process: proc });
  proc.emit('SIGTERM');
  assert.equal(await stopped, 'SIGTERM');
});

test('shuts down cleanly when supervisor closes stdin (for Windows without SIGTERM)', async () => {
  const proc = fakeProcess();
  const stdin = new PassThrough();
  const stopped = stopSignal({ process: proc, stdin });
  stdin.write('任何内容都只读走\n');
  stdin.end();
  assert.equal(await stopped, 'stdin_closed');
});

test('listens for stdin EOF only when PLASTICINE_STOP_ON_STDIN_EOF=1 (systemd opens stdin at EOF)', () => {
  assert.equal(stopOnStdinEof({ PLASTICINE_STOP_ON_STDIN_EOF: '1' }), true);
  assert.equal(stopOnStdinEof({}), false);
  assert.equal(stopOnStdinEof({ PLASTICINE_STOP_ON_STDIN_EOF: '0' }), false);
});
