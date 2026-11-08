import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  createCloudBrowserActTool,
  createCloudSshRunTool,
  createListInboxTool,
  getTimeTool,
  ToolRegistry,
  type ToolContext,
} from '../../../src/brain/index.ts';

function context(): ToolContext {
  const signal = new AbortController().signal;
  return { signal, runId: 'run-1', callId: 'call-1', actionId: 'a1', now: () => new Date() };
}

test('工具组的开关：关掉的工具不出现在给模型的列表里，也不算提供过', () => {
  const registry = new ToolRegistry();
  const ssh = createCloudSshRunTool({ run: async () => ({ exitCode: 0, stdout: '', stderr: '' }) });
  registry.register(getTimeTool);
  registry.register(ssh);
  assert.deepEqual(registry.descriptors('conversation').map((tool) => tool.name), ['get_time', 'cloud_ssh_run']);
  registry.setGate((name) => name !== 'cloud_ssh_run');
  assert.deepEqual(registry.descriptors('conversation').map((tool) => tool.name), ['get_time']);
  assert.equal(registry.isOffered('cloud_ssh_run', 'conversation'), false);
});

test('会改外面的工具：云端命令和浏览器操作是 once + external，第 97 条起不用逐次批准', () => {
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

test('看站内信的结果标着「外部资料」', async () => {
  const inbox = createListInboxTool({ list: () => ({ messages: [], total: 0 }) });
  assert.equal(JSON.parse(await inbox.execute({}, context())).untrustedMaterial, true);
});
