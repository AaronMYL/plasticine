// 派发前的「等一等」（devices/holds.ts）：他正在用电脑时，动真键盘真鼠标的、改他眼前窗口的都等他停下；别的线刚截过图、
// 点过，这台电脑的屏幕两分钟内归它。11-16 加的按键、滚动、双击右键拖动、截一块、截窗口、改窗口也都要照这两条。

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DEVICE_ACTION_KINDS, type DeviceActionKind, type DeviceNode, type NodeAction } from '../../shared/state.ts';
import { holdFor, LEASED_KINDS, PRESENCE_KINDS, type HoldState } from '../../src/devices/holds.ts';

const NOW = new Date('2026-11-17T08:00:00.000Z');
const AGO = (seconds: number): string => new Date(NOW.getTime() - seconds * 1000).toISOString();

function node(idleSeconds: number | null, capabilities: readonly DeviceActionKind[] = DEVICE_ACTION_KINDS): DeviceNode {
  return { id: 'node-1', name: '示例 Mac', platform: 'macos', revokedAt: null, lastSeenAt: AGO(5),
    capabilities: [...capabilities], idleSeconds, idleReportedAt: idleSeconds === null ? null : AGO(5),
  } as unknown as DeviceNode;
}

/** other：另一条线最近在这台电脑上做的那一下（没有就是没人占着屏幕）。 */
function stateWith(other: { kind: DeviceActionKind; lineStatus: string } | null): HoldState {
  return {
    nodeActions: { latestOfKinds: (_nodeId: string, kinds: readonly string[]) => other === null
      || !kinds.includes(other.kind) ? undefined : { runId: 'line:other', kind: other.kind } as unknown as NodeAction },
    lines: { get: () => (other === null ? undefined : { status: other.lineStatus }) },
  } as unknown as HoldState;
}

const why = (kind: DeviceActionKind, state: HoldState, at: DeviceNode): string | null =>
  holdFor(state, at, kind, 'line:mine', NOW)?.why ?? null;

test('他正在用电脑：真键盘、真鼠标、改窗口都等他停下；截图和后台读写应用不等', () => {
  const busy = node(3);
  for (const kind of ['input_click', 'input_type', 'input_key', 'input_scroll', 'input_mouse', 'window_act'] as const) {
    assert.equal(why(kind, stateWith(null), busy), 'user_active', kind);
  }
  for (const kind of ['screen_capture', 'screen_zoom', 'window_capture', 'app_perceive', 'app_act', 'app_menu',
    'tab_act', 'tab_paste'] as const) {
    assert.equal(why(kind, stateWith(null), busy), null, kind);
  }
});

test('他 30 秒没动、或者没报空闲时间：照常做', () => {
  assert.equal(why('input_key', stateWith(null), node(45)), null);
  assert.equal(why('input_mouse', stateWith(null), node(null)), null);
});

test('别的线刚在这台电脑上截过图或动过键鼠：屏幕归它，截图和真键鼠都等', () => {
  const held = stateWith({ kind: 'input_mouse', lineStatus: 'running' });
  for (const kind of ['screen_capture', 'screen_zoom', 'window_capture', 'input_click', 'input_type', 'input_key',
    'input_scroll', 'input_mouse'] as const) {
    assert.equal(why(kind, held, node(600)), 'busy', kind);
  }
  assert.equal(why('tab_act', held, node(600)), null);
  // 占着屏幕的那条线停了：租约作废。
  assert.equal(why('input_key', stateWith({ kind: 'input_mouse', lineStatus: 'idle' }), node(600)), null);
});

test('动真键盘真鼠标的每一种动作都登记了让路和租约', () => {
  for (const kind of DEVICE_ACTION_KINDS.filter((name) => name.startsWith('input_'))) {
    assert.ok((PRESENCE_KINDS as readonly string[]).includes(kind), `${kind} 没登记用户在场让路`);
    assert.ok((LEASED_KINDS as readonly string[]).includes(kind), `${kind} 没登记屏幕租约`);
  }
});

test('没给系统权限的能力：告诉他去打开哪一项，不是让他重开 App', () => {
  const without = (kind: DeviceActionKind): DeviceNode =>
    node(600, DEVICE_ACTION_KINDS.filter((name) => name !== kind));
  const remedy = (kind: DeviceActionKind): string | null =>
    holdFor(stateWith(null), without(kind), kind, 'line:mine', NOW)?.remedy ?? null;
  for (const kind of ['input_key', 'input_scroll', 'input_mouse', 'window_act', 'window_list', 'app_perceive',
    'app_act', 'app_menu'] as const) {
    assert.equal(remedy(kind), '辅助功能', kind);
  }
  assert.equal(remedy('screen_zoom'), '屏幕录制');
  assert.equal(remedy('window_capture'), '屏幕录制');
  assert.equal(remedy('calendar_update'), '日历（完全访问）');
});
