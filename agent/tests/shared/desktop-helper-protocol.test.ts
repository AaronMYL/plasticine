// 壳 ↔ Mac 助手协议（第 14、15 条）：TypeScript 这份和 Swift 那份（mac/Sources/PlasticineDevice）一一对应；
// 设备动作换成助手调用、按权限算能力。

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { Value } from 'typebox/value';
import type { DeviceActionParams } from '../../shared/api/index.ts';
import { DEVICE_RESULT_SCHEMAS } from '../../shared/api/index.ts';
import {
  HELPER_DEVICE_KINDS, HELPER_ERROR_CODES, HELPER_METHOD_NAMES, HELPER_METHODS, HELPER_PERMISSIONS,
  HelperResponseSchema, helperCallFor, helperCapabilities, isHelperMethod,
} from '../../shared/desktop-helper-protocol.ts';

const SWIFT = new URL('../../../mac/Sources/PlasticineDevice/', import.meta.url);

function swiftSource(file: string): string {
  return readFileSync(new URL(file, SWIFT), 'utf8');
}

/** enum 的 case → 原始值（没写原始值就是名字本身）。 */
function swiftCases(source: string, enumName: string): Map<string, string> {
  const start = source.indexOf(`enum ${enumName}`);
  assert.ok(start >= 0, `Swift 里没有 enum ${enumName}`);
  const body = source.slice(start, source.indexOf('\n}', start));
  const cases = new Map<string, string>();
  for (const match of body.matchAll(/^\s{4}case (\w+)(?: = "([^"]+)")?$/gm)) {
    const name = match[1] ?? '';
    cases.set(name, match[2] ?? name);
  }
  return cases;
}

test('方法名和每个方法的参数名两边一样', () => {
  const source = swiftSource('helper-methods.swift');
  const cases = swiftCases(source, 'HelperMethod');
  assert.deepEqual([...cases.values()].sort(), [...HELPER_METHOD_NAMES].sort());
  const block = source.slice(source.indexOf('var parameters'));
  const swiftParams = new Map<string, string[]>();
  for (const match of block.matchAll(/case ((?:\.\w+(?:, )?)+):\s*(?:\n\s*)?return \[([^\]]*)\]/g)) {
    const names = [...(match[2] ?? '').matchAll(/"(\w+)"/g)].map((name) => name[1] ?? '').sort();
    for (const member of (match[1] ?? '').split(', ')) {
      swiftParams.set(cases.get(member.slice(1)) ?? member, names);
    }
  }
  for (const method of HELPER_METHOD_NAMES) {
    const ts = Object.keys(HELPER_METHODS[method].params.properties).sort();
    assert.deepEqual(swiftParams.get(method), ts, `${method} 的参数两边不一样`);
  }
});

test('错误码和权限名两边一样', () => {
  const protocol = swiftCases(swiftSource('helper-protocol.swift'), 'HelperErrorCode');
  assert.deepEqual([...protocol.values()].sort(), [...HELPER_ERROR_CODES].sort());
  const permissions = swiftCases(swiftSource('helper-methods.swift'), 'HelperPermission');
  assert.deepEqual([...permissions.values()].sort(), [...HELPER_PERMISSIONS].sort());
});

test('回执要么带结果要么带错误，读不懂的那行 id 是 null', () => {
  assert.ok(Value.Check(HelperResponseSchema, { id: 'h1', result: {} }));
  assert.ok(Value.Check(HelperResponseSchema, { id: null, error: { code: 'invalid_request', message: '不是 JSON' } }));
  assert.ok(!Value.Check(HelperResponseSchema, { id: null, result: {} }));
  assert.ok(!Value.Check(HelperResponseSchema, { id: 'h1', error: { code: 'oops', message: '' } }));
  assert.ok(isHelperMethod('calendar.events'));
  assert.ok(!isHelperMethod('browser.open'));
});

test('设备动作换成助手调用：日历、提醒、文件、截屏都归助手，浏览器和网页标签不归', () => {
  const cases: [DeviceActionParams, string, Record<string, unknown>][] = [
    [{ kind: 'calendar_list', from: '2026-11-08T00:00:00.000Z', to: '2026-11-15T00:00:00.000Z' }, 'calendar.events',
      { from: '2026-11-08T00:00:00.000Z', to: '2026-11-15T00:00:00.000Z' }],
    [{ kind: 'calendar_create', title: '看牙', start: '2026-11-09T02:00:00.000Z', end: '2026-11-09T03:00:00.000Z',
      allDay: false, location: null, notes: null }, 'calendar.create',
    { title: '看牙', start: '2026-11-09T02:00:00.000Z', end: '2026-11-09T03:00:00.000Z', allDay: false,
      location: null, notes: null }],
    [{ kind: 'reminder_list', includeCompleted: false }, 'reminders.list', { includeCompleted: false }],
    [{ kind: 'reminder_create', title: '交房租', due: null, notes: null }, 'reminders.create',
      { title: '交房租', due: null, notes: null }],
    [{ kind: 'reminder_complete', reminderId: 'r-1' }, 'reminders.complete', { reminderId: 'r-1' }],
    [{ kind: 'run_command', cwd: '~', command: 'ls' }, 'command.run', { command: 'ls', cwd: '~' }],
    [{ kind: 'input_click', x: 3, y: 4 }, 'click', { x: 3, y: 4 }],
    [{ kind: 'screen_capture' }, 'screenshot', {}],
    [{ kind: 'file_write', path: '~/a.txt', content: '你好', baseVersion: null }, 'files.write',
      { path: '~/a.txt', content: '你好', baseVersion: null }],
  ];
  for (const [action, method, params] of cases) {
    const call = helperCallFor(action);
    assert.deepEqual(call, { method, params });
    assert.ok(call !== null && Value.Check(HELPER_METHODS[call.method].params, call.params), `${method} 参数不过 schema`);
  }
  assert.equal(helperCallFor({ kind: 'browser_open', url: 'https://example.com/' }), null);
  assert.equal(helperCallFor({ kind: 'tab_list' }), null);
  assert.equal(helperCallFor({ kind: 'file_delete', path: '~/a' }), null);
  for (const kind of HELPER_DEVICE_KINDS) {
    assert.ok(kind in DEVICE_RESULT_SCHEMAS);
  }
});

test('Mac 助手回的日程多带日历颜色和有没有别人参加，iPhone 的旧形状照样过', () => {
  const schema = HELPER_METHODS['calendar.events'].result;
  const event = { id: 'e1', title: '产品周会', start: '2026-11-08T06:00:00.000Z', end: '2026-11-08T07:00:00.000Z',
    allDay: false, location: null, notes: null, calendar: '工作' };
  assert.ok(Value.Check(schema, { events: [event], truncated: false }));
  assert.ok(Value.Check(schema, { events: [{ ...event, calendarId: 'c1', color: '#1BADF8', withOthers: true }],
    truncated: false }));
  assert.ok(!Value.Check(schema, { events: [{ ...event, color: 'blue' }], truncated: false }));
});

test('按权限算能力：没给日历就不报日历，文件和命令总是报', () => {
  const none = helperCapabilities({ screen: false, accessibility: false, calendar: 'denied',
    reminders: 'not_determined' });
  assert.deepEqual(none, ['file_list', 'file_read', 'file_write', 'run_command']);
  const all = helperCapabilities({ screen: true, accessibility: true, calendar: 'granted', reminders: 'granted' });
  assert.deepEqual(all, [...HELPER_DEVICE_KINDS]);
  const writeOnly = helperCapabilities({ screen: false, accessibility: false, calendar: 'write_only',
    reminders: 'granted' });
  assert.ok(!writeOnly.includes('calendar_list') && writeOnly.includes('reminder_list'));
});
