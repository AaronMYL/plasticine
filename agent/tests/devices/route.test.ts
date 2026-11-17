// 设备不在线时这一步去哪做（devices/route.ts）：在线的电脑优先（Mac、Windows、Linux 的桌面客户端一样算），
// 只是看网页、不用登录的去云端，其余等电脑上线。

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DEVICE_ACTION_KINDS, type DeviceNode } from '../../shared/state.ts';
import { choosePlace } from '../../src/devices/index.ts';

const NOW = new Date('2026-11-17T08:00:00.000Z');

function node(id: string, platform: string, online: boolean, revoked = false): DeviceNode {
  return { id, name: id, platform, capabilities: [...DEVICE_ACTION_KINDS],
    revokedAt: revoked ? NOW.toISOString() : null,
    lastSeenAt: new Date(NOW.getTime() - (online ? 5_000 : 3_600_000)).toISOString() } as unknown as DeviceNode;
}

test('在线的电脑不管是 Mac、Windows 还是 Linux，都去那台电脑做', () => {
  for (const platform of ['macos', 'windows', 'linux']) {
    const choice = choosePlace('tab_act', true, [node('pc', platform, true)], NOW);
    assert.deepEqual([choice.place, choice.nodeId], ['mac', 'pc'], platform);
    assert.equal(choice.reason, '在电脑上用你的登录做');
  }
});

test('电脑都不在线：只是看网页、不用登录的去云端，要登录或要点要填的等电脑', () => {
  const offline = [node('pc', 'windows', false), node('gone', 'macos', true, true)];
  assert.equal(choosePlace('tab_open', false, offline, NOW).place, 'cloud');
  assert.equal(choosePlace('tab_open', true, offline, NOW).place, 'wait_mac');
  const wait = choosePlace('tab_act', false, offline, NOW);
  assert.deepEqual([wait.place, wait.nodeId], ['wait_mac', null]);
  assert.equal(wait.reason, '要用你在电脑上的登录；电脑上线就接着做');
});

test('网页版登录的设备不算电脑', () => {
  assert.equal(choosePlace('tab_act', true, [node('web', 'browser', true)], NOW).place, 'wait_mac');
});
