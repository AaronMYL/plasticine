import assert from 'node:assert/strict';
import { test } from 'node:test';
import { showAuthorization } from '../src/shared-terminal.ts';
import { assertNoPrivateText, captureLogs } from './safety-helpers.ts';

test('授权代码只显示在交互终端，重定向时拒绝且不写日志或标准输出', (context) => {
  const logs = captureLogs(context);
  const output: string[] = [];
  if ('isTTY' in process.stdout) {
    context.mock.property(process.stdout, 'isTTY', false);
  }
  context.mock.method(process.stdout, 'write', (text: string) => {
    output.push(text);
    return true;
  });
  assert.throws(() => showAuthorization('pairing', '123456', '2026-10-28T12:00:00.000Z'));
  assert.deepEqual(output, []);
  assertNoPrivateText(logs);
});
