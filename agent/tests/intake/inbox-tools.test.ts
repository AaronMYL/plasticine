import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createCloudBrowserActTool, createCloudSshRunTool } from '../../src/cloud-tools/index.ts';
import { createListInboxTool } from '../../src/intake/index.ts';
import { getTimeTool, ToolRegistry, type ToolContext } from '../../src/tools/index.ts';

function context(): ToolContext {
  const signal = new AbortController().signal;
  return { signal, runId: 'run-1', callId: 'call-1', actionId: 'a1', now: () => new Date() };
}

test('disabled tool group omits its tools from model list and counts as not provided', () => {
  const registry = new ToolRegistry();
  const ssh = createCloudSshRunTool({ run: async () => ({ exitCode: 0, stdout: '', stderr: '' }) });
  registry.register(getTimeTool);
  registry.register(ssh);
  assert.deepEqual(registry.descriptors('conversation').map((tool) => tool.name), ['get_time', 'cloud_ssh_run']);
  registry.setGate((name) => name !== 'cloud_ssh_run');
  assert.deepEqual(registry.descriptors('conversation').map((tool) => tool.name), ['get_time']);
  assert.equal(registry.isOffered('cloud_ssh_run', 'conversation'), false);
});

test('cloud command and browser actions use once+external without per-call approval', () => {
  const ssh = createCloudSshRunTool({ run: async () => ({ exitCode: 0, stdout: '', stderr: '' }) });
  const act = createCloudBrowserActTool({
    act: async () => ({ open: true, url: null, title: null, updatedAt: null, lastAction: null }),
  });
  for (const tool of [ssh, act]) {
    assert.equal(tool.replay, 'once');
    assert.equal(tool.effect, 'external');
    assert.equal(tool.permission, 'auto');
    assert.equal(tool.roles.includes('verifier'), false);
  }
});

test('reading inbox marks tool result as external data', async () => {
  const inbox = createListInboxTool({ list: () => ({ messages: [], total: 0 }) });
  assert.equal(JSON.parse(await inbox.execute({}, context())).untrustedMaterial, true);
});
