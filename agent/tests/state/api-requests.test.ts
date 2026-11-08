import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';
import type { ApiRequestRecord } from '../../shared/state.ts';
import { openTestState, START, throwsState, type TestState } from './helpers.ts';

let t: TestState;

beforeEach(async () => {
  t = await openTestState();
});

afterEach(async () => {
  await t.cleanup();
});

const at = (offsetMs: number): string => new Date(START + offsetMs).toISOString();

function record(overrides: Partial<ApiRequestRecord> = {}): ApiRequestRecord {
  return {
    requestId: 'req-1',
    scope: 'POST /v2/notes',
    deviceId: null,
    status: 201,
    body: { id: 'note-1', title: '中文标题' },
    createdAt: at(0),
    expiresAt: at(86_400_000),
    ...overrides,
  };
}

test('存下回执后按 request_id 原样取回', () => {
  t.state.apiRequests.save(record());
  assert.deepEqual(t.state.apiRequests.find('req-1'), { ...record(), bodyDigest: null });
  assert.equal(t.state.apiRequests.find('req-2'), undefined);
});

test('带签名的请求连请求体摘要一起存，过期后的新请求换成新摘要', () => {
  t.state.apiRequests.save(record({ bodyDigest: 'digest-1' }));
  assert.equal(t.state.apiRequests.find('req-1')?.bodyDigest, 'digest-1');
  t.state.apiRequests.save(record({ bodyDigest: 'digest-2', createdAt: at(90_000_000) }));
  assert.equal(t.state.apiRequests.find('req-1')?.bodyDigest, 'digest-2');
});

test('同一 id 再存一次覆盖原行（过期后的新请求），表里仍只有一行', () => {
  t.state.apiRequests.save(record());
  t.state.apiRequests.save(record({ status: 200, body: { again: true }, createdAt: at(90_000_000) }));
  const found = t.state.apiRequests.find('req-1');
  assert.equal(found?.status, 200);
  assert.deepEqual(found?.body, { again: true });
});

test('状态码不在 100–599 拒绝', () => {
  throwsState(() => t.state.apiRequests.save(record({ status: 42 })), 'invalid_input');
});
