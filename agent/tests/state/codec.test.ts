import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Type } from 'typebox';
import { checked, columnName, decodeRow, encodeRow, normalizeTimes, readRow } from '../../src/state/codec.ts';
import { StateError } from '../../src/state/errors.ts';
import { brainChange, openTestState, throwsState } from './helpers.ts';

const COLUMNS = { chatId: 'text', active: 'boolean', replyLayers: 'json', retryBudget: 'integer' } as const;

test('驼峰字段名对应下划线列名', () => {
  assert.equal(columnName('confirmedByDeviceAt'), 'confirmed_by_device_at');
  assert.equal(columnName('p'), 'p');
});

test('布尔存成 0 / 1、JSON 存成文本，读回来还原；缺的字段存 NULL', () => {
  const params = encodeRow(COLUMNS, { chatId: '2026-10-27', active: false, replyLayers: { reasoning: '理由' } });
  const stored = '{"reasoning":"理由"}';
  assert.deepEqual(params, { chat_id: '2026-10-27', active: 0, reply_layers: stored, retry_budget: null });
  const decoded = decodeRow(COLUMNS, { chat_id: '2026-10-27', active: 0, reply_layers: stored, retry_budget: 3 });
  assert.deepEqual(decoded, { chatId: '2026-10-27', active: false, replyLayers: { reasoning: '理由' }, retryBudget: 3 });
});

test('值和列类型对不上时拒绝写入', () => {
  throwsState(() => encodeRow(COLUMNS, { retryBudget: '三' }), 'invalid_input');
});

test('库里存坏了的 JSON 或不符合 schema 的行读出时报 corrupt_record，不悄悄返回', () => {
  throwsState(() => decodeRow(COLUMNS, { reply_layers: '{坏的' }), 'corrupt_record');
  const schema = Type.Object({ chatId: Type.String({ minLength: 1 }) });
  throwsState(() => readRow(schema, { chatId: 'text' }, { chat_id: '' }, 'messages'), 'corrupt_record');
});

test('时间字段入库前统一成毫秒精度的 UTC：不同偏移、不同小数位都换成同一种写法，别的字段不动', () => {
  const schema = Type.Object({
    at: Type.String({ format: 'date-time' }),
    maybe: Type.Union([Type.String({ format: 'date-time' }), Type.Null()]),
    name: Type.String(),
  });
  const values = {
    at: '2026-10-27T16:00:00+08:00',
    maybe: '2026-10-27T08:00:00.5Z',
    name: '2026-10-27T16:00:00+08:00',
  };
  assert.deepEqual(normalizeTimes(schema, values), {
    at: '2026-10-27T08:00:00.000Z',
    maybe: '2026-10-27T08:00:00.500Z',
    name: '2026-10-27T16:00:00+08:00',
  });
  assert.deepEqual(normalizeTimes(schema, { maybe: null }), { maybe: null });
});

test('时间带时区偏移写进来，存的是 UTC，按字符串排序也对', async () => {
  const t = await openTestState();
  try {
    const at = '2026-12-31T08:00:00+08:00';
    const device = t.state.devices.create({ name: '测试设备', firstSeenAt: at, lastSeenAt: at });
    assert.equal(device.firstSeenAt, '2026-12-31T00:00:00.000Z');
    assert.equal(t.state.devices.require(device.id).firstSeenAt, '2026-12-31T00:00:00.000Z');
  } finally {
    await t.cleanup();
  }
});

test('校验失败的错误指出第一个出错的字段', () => {
  const schema = Type.Object({ outer: Type.Object({ inner: Type.Integer() }) });
  try {
    checked(schema, { outer: { inner: 'x' } }, 'invalid_input', '测试');
    assert.fail('应当抛错');
  } catch (error) {
    assert.ok(error instanceof StateError);
    assert.equal(error.field, 'outer.inner');
  }
});
