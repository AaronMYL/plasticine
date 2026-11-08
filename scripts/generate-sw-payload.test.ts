import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Value } from 'typebox/value';
import { PushPayloadSchema } from '../agent/shared/api/push.ts';
import { pushValidator } from './generate-sw-payload.ts';

test('service worker 校验代码由共享 schema 生成，空串、缺字段、数组和畸形载荷同判', () => {
  const validate = new Function(`${pushValidator()}\nreturn isPushPayload;`)() as (value: unknown) => boolean;
  const valid = { title: '', body: '', tag: '', url: '/' };
  const values: unknown[] = [valid, null, [], {}, 'text', { ...valid, extra: true }];
  for (const key of Object.keys(valid)) {
    const missing: Record<string, unknown> = { ...valid };
    delete missing[key];
    values.push(missing);
    for (const value of [null, false, 3, [], {}, '', '/x', 'https://outside.example']) {
      values.push({ ...valid, [key]: value });
    }
  }
  for (const value of values) {
    assert.equal(validate(value), Value.Check(PushPayloadSchema, value));
  }
});
