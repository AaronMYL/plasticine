import assert from 'node:assert/strict';
import type { TestContext } from 'node:test';
import { format } from 'node:util';

// 用户指定的合成回归样本，不是真实凭据或用户数据。
export const PRIVATE_ERROR_TEXT = '私事 hunter2 https://x.example/?token=abc';
export const CREDENTIAL_PARAMS = [
  'authkey', 'accesstoken', 'AUTH_KEY', 'x-amz-signature', 'apikey', 'clientSecret', 'sessionid',
];

export function privateError(): Error {
  return new Error(PRIVATE_ERROR_TEXT, { cause: new Error(PRIVATE_ERROR_TEXT) });
}

export function captureLogs(context: TestContext): string[] {
  const lines: string[] = [];
  for (const level of ['log', 'warn', 'error'] as const) {
    context.mock.method(console, level, (...args: unknown[]) => lines.push(format(...args)));
  }
  return lines;
}

export function assertNoPrivateText(value: unknown): void {
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  assert.doesNotMatch(text, /私事|hunter2|https:\/\/x\.example|token=abc/);
}
