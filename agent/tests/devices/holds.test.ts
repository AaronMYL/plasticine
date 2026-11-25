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

function stateWith(other: { kind: DeviceActionKind; lineStatus: string } | null): HoldState {
  return {
    nodeActions: { latestOfKinds: (_nodeId: string, kinds: readonly string[]) => other === null
      || !kinds.includes(other.kind) ? undefined : { runId: 'line:other', kind: other.kind } as unknown as NodeAction },
    lines: { get: () => (other === null ? undefined : { status: other.lineStatus }) },
  } as unknown as HoldState;
}

const why = (kind: DeviceActionKind, state: HoldState, at: DeviceNode): string | null =>
  holdFor(state, at, kind, 'line:mine', NOW)?.why ?? null;

test('active user pauses real keyboard, mouse, and window actions; screenshot and background proceed', () => {
  const busy = node(3);
  for (const kind of ['input_click', 'input_type', 'input_key', 'input_scroll', 'input_mouse', 'window_act'] as const) {
    assert.equal(why(kind, stateWith(null), busy), 'user_active', kind);
  }
  for (const kind of ['screen_capture', 'screen_zoom', 'window_capture', 'app_perceive', 'app_act', 'app_menu',
    'tab_act', 'tab_paste'] as const) {
    assert.equal(why(kind, stateWith(null), busy), null, kind);
  }
});

test('proceeds normally when user is idle >=30s or device reports no idle time', () => {
  assert.equal(why('input_key', stateWith(null), node(45)), null);
  assert.equal(why('input_mouse', stateWith(null), node(null)), null);
});

test('screen lease held by another line makes screenshots and real input wait', () => {
  const held = stateWith({ kind: 'input_mouse', lineStatus: 'running' });
  for (const kind of ['screen_capture', 'screen_zoom', 'window_capture', 'input_click', 'input_type', 'input_key',
    'input_scroll', 'input_mouse'] as const) {
    assert.equal(why(kind, held, node(600)), 'busy', kind);
  }
  assert.equal(why('tab_act', held, node(600)), null);
  assert.equal(why('input_key', stateWith({ kind: 'input_mouse', lineStatus: 'idle' }), node(600)), null);
});

test('every real keyboard and mouse action type registers yield and screen lease', () => {
  for (const kind of DEVICE_ACTION_KINDS.filter((name) => name.startsWith('input_'))) {
    assert.ok((PRESENCE_KINDS as readonly string[]).includes(kind), `${kind} 没登记用户在场让路`);
    assert.ok((LEASED_KINDS as readonly string[]).includes(kind), `${kind} 没登记屏幕租约`);
  }
});

test('missing OS permission tells user which setting to enable instead of restarting app', () => {
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
