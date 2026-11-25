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

test('Stored receipt is retrieved verbatim by request_id', () => {
  t.state.apiRequests.save(record());
  assert.deepEqual(t.state.apiRequests.find('req-1'), { ...record(), bodyDigest: null });
  assert.equal(t.state.apiRequests.find('req-2'), undefined);
});

test('Signed request stores body hash; new request after expiry replaces hash', () => {
  t.state.apiRequests.save(record({ bodyDigest: 'digest-1' }));
  assert.equal(t.state.apiRequests.find('req-1')?.bodyDigest, 'digest-1');
  t.state.apiRequests.save(record({ bodyDigest: 'digest-2', createdAt: at(90_000_000) }));
  assert.equal(t.state.apiRequests.find('req-1')?.bodyDigest, 'digest-2');
});

test('Saving same request_id again overwrites existing row, keeping a single row', () => {
  t.state.apiRequests.save(record());
  t.state.apiRequests.save(record({ status: 200, body: { again: true }, createdAt: at(90_000_000) }));
  const found = t.state.apiRequests.find('req-1');
  assert.equal(found?.status, 200);
  assert.deepEqual(found?.body, { again: true });
});

test('Rejects HTTP status codes outside 100-599', () => {
  throwsState(() => t.state.apiRequests.save(record({ status: 42 })), 'invalid_input');
});
