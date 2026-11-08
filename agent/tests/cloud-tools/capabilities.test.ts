import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CapabilityCatalog } from '../../src/capabilities/index.ts';

test('能力目录区分开关、实现、配置和真实连接；打开开关不把未接通道说成可用', async () => {
  const catalog = new CapabilityCatalog();
  const adapter = { id: 'ssh', label: 'SSH', tools: ['cloud_ssh_run'], enabled: () => true,
    inspect: async () => ({ supported: false, configured: false, connected: false,
      detail: '没有装配 SSH transport。' }) };
  catalog.register(adapter);
  catalog.register({ ...adapter, id: 'browser', inspect: async () => ({ supported: true,
    configured: true, connected: true, detail: 'CDP 已回应。' }) });
  catalog.register({ ...adapter, id: 'disabled', enabled: () => false, inspect: async () => ({ supported: true,
    configured: true, connected: true, detail: '服务在线但工具组已关闭。' }) });
  const result = await catalog.inspect(new AbortController().signal);
  assert.equal(result[0]?.enabled, true);
  assert.equal(result[0]?.ready, false);
  assert.equal(result[0]?.status, 'unsupported');
  assert.equal(result[1]?.ready, true);
  assert.equal(result[2]?.ready, false);
  assert.equal(result[2]?.status, 'disabled');
});

test('连接状态必须有实际证据，未知和探测异常均不能当成 ready', async () => {
  const catalog = new CapabilityCatalog();
  catalog.register({ id: 'unproven', label: '未核实', tools: [], enabled: () => true,
    inspect: async () => ({ supported: true, configured: true, connected: null, detail: '尚未探测。' }) });
  catalog.register({ id: 'failed', label: '失败', tools: [], enabled: () => true,
    inspect: async () => { throw new Error('断开'); } });
  const result = await catalog.inspect(new AbortController().signal);
  assert.equal(result[0]?.status, 'unknown');
  assert.equal(result[0]?.ready, false);
  assert.equal(result[1]?.status, 'disconnected');
  assert.equal(result[1]?.ready, false);
});
