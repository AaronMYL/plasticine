import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import type { IncomingMessage } from 'node:http';
import { test } from 'node:test';
import { Type } from 'typebox';
import { ApiError, toApiError } from '../../src/app/api-error.ts';
import { readJsonBody } from '../../src/app/http.ts';
import { checkInput } from '../../src/app/validate.ts';
import { DailyError } from '../../src/daily/index.ts';
import { AttentionError } from '../../src/attention/index.ts';
import { ArtifactError } from '../../src/artifacts/index.ts';
import { CloudToolError } from '../../src/cloud-tools/index.ts';
import { LifeError } from '../../src/life/index.ts';
import { StateError } from '../../src/state/index.ts';
import { checked } from '../../src/state/codec.ts';
import { assertNoPrivateText, PRIVATE_ERROR_TEXT, privateError } from '../safety-helpers.ts';

test('JSON parse error does not echo request body fragment to client', async () => {
  const req = Readable.from([Buffer.from(PRIVATE_ERROR_TEXT)]) as IncomingMessage;
  req.headers = { 'content-type': 'application/json' };
  await assert.rejects(readJsonBody(req), (error: unknown) => {
    assert.ok(error instanceof ApiError);
    assert.equal(error.status, 400);
    assertNoPrivateText(error.body());
    return true;
  });
});

test('unknown internal and controlled state errors hide raw details while preserving status/version', () => {
  for (const error of [
    privateError(),
    new StateError('duplicate', PRIVATE_ERROR_TEXT, { cause: privateError() }),
    new StateError('version_conflict', PRIVATE_ERROR_TEXT, { currentVersion: 3 }),
    new DailyError('invalid_input', PRIVATE_ERROR_TEXT, 'url'),
    new AttentionError('invalid_answer', PRIVATE_ERROR_TEXT, 'answer'),
  ]) {
    const response = toApiError(error).error;
    assertNoPrivateText(response.body());
    if (error instanceof StateError && error.code === 'version_conflict') {
      assert.equal(response.status, 409);
      assert.equal(response.currentVersion, 3);
    }
  }
});

test('business rejection preserves specific reason and cause chain for field-level fixes', () => {
  const cases = [
    { error: new CloudToolError('failed', 'IMAP INBOX 的 UID 17 获取失败'), status: 502 },
    { error: new LifeError('invalid_input', '周报的开始日期晚于结束日期', 'start'), status: 400 },
    { error: new ArtifactError('unsupported_type', '报表附件不是受支持的文本或 PDF'), status: 415 },
  ];
  for (const { error, status } of cases) {
    const cause = new Error('本次原操作的具体上下文：十一月报表');
    error.cause = cause;
    const response = toApiError(error).error;
    assert.equal(response.status, status);
    assert.equal(response.body().error, `${error.message}\n原因：${cause.message}`);
    assert.equal(response.field, error.field);
  }
});

test('unknown field validation does not echo caller\'s property name in field or message', () => {
  const schema = Type.Object({ text: Type.String() }, { additionalProperties: false });
  assert.throws(() => checkInput(schema, { text: '合成内容', [PRIVATE_ERROR_TEXT]: true }, '请求'), (error: unknown) => {
    assert.ok(error instanceof ApiError);
    assertNoPrivateText(error.body());
    return true;
  });
});

test('dynamic property names in state validation stay out of API errors while locating schema field', () => {
  const schema = Type.Object({ values: Type.Record(Type.String(), Type.Integer()) });
  assert.throws(() => checked(schema, { values: { [PRIVATE_ERROR_TEXT]: 'bad' } }, 'invalid_input', '记录'),
    (error: unknown) => {
      assert.ok(error instanceof StateError);
      assertNoPrivateText(toApiError(error).error.body());
      assert.equal(error.field, 'values');
      return true;
    });
});

test('state validation keeps known array/union schema fields without echoing extra/missing raw keys', () => {
  const schema = Type.Object({ entries: Type.Array(Type.Union([
    Type.Object({ count: Type.Integer() }, { additionalProperties: false }),
    Type.Null(),
  ])) });
  for (const entry of [{ count: PRIVATE_ERROR_TEXT }, { count: 1, [PRIVATE_ERROR_TEXT]: true }, {}]) {
    assert.throws(() => checked(schema, { entries: [entry] }, 'invalid_input', '记录'), (error: unknown) => {
      assert.ok(error instanceof StateError);
      assertNoPrivateText(toApiError(error).error.body());
      assert.match(error.field ?? '', /^entries(?:\.0(?:\.count)?)?$/);
      return true;
    });
  }
});
