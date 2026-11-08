// 云端浏览器工具（直接调工具；2026-11-05 起它们由新内核经 lines/legacy.ts 调用，旧调度器的回执重放测试随旧调度器删掉）。

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { setTimeout as pause } from 'node:timers/promises';
import { CloudBrowser, CdpBrowser } from '../../../src/cloud-tools/index.ts';
import { createCloudBrowserActTool, createCloudBrowserOpenTool, createCloudBrowserReadTool,
  createCloudBrowserObserveTool, ToolRegistry } from '../../../src/brain/index.ts';
import type { ModelImage } from '../../../shared/model.ts';
import { fakeCdp } from '../../cloud-tools/fake-cdp.ts';
import { toolContext } from '../helpers.ts';

test('先观察截图与元素再操作：观察带图、页面是外部资料，点击发到同一个标签', async (t) => {
  const fake = await fakeCdp();
  const browser = new CloudBrowser({ transport: new CdpBrowser({ endpoint: fake.endpoint }), now: () => new Date() });
  t.after(async () => { browser.close(); await fake.close(); });
  const signal = AbortSignal.timeout(3_000);
  await createCloudBrowserOpenTool(browser).execute({ url: 'https://example.test/work' },
    toolContext('c1', { signal }));
  const images: ModelImage[] = [];
  const observed = await createCloudBrowserObserveTool(browser).execute({}, toolContext('c2',
    { signal, emitImage: (image) => images.push(image) }));
  assert.equal(images.length, 1);
  const page = JSON.parse(observed);
  assert.equal(page.untrustedMaterial, true);
  assert.equal(page.elements[0].text, '编辑');
  await createCloudBrowserActTool(browser).execute({ action: { kind: 'click', x: 20, y: 30 },
    observationId: page.observationId }, toolContext('c3', { signal }));
  assert.ok(fake.commands.filter((command) => command.method === 'Input.dispatchMouseEvent')
    .every((command) => command.sessionId === `session-${page.tabId}`));
});

test('工具组关掉就不提供；打开、读页面走真实 CDP，操作不用逐次批准', async (t) => {
  const fake = await fakeCdp();
  const browser = new CloudBrowser({ transport: new CdpBrowser({ endpoint: fake.endpoint }), now: () => new Date() });
  t.after(async () => { browser.close(); await fake.close(); });
  const tools = [createCloudBrowserOpenTool(browser), createCloudBrowserReadTool(browser),
    createCloudBrowserActTool(browser)];
  const registry = new ToolRegistry();
  for (const tool of tools) {
    registry.register(tool);
  }
  registry.setGate(() => false);
  assert.equal(registry.descriptors('conversation').length, 0);
  assert.equal(tools[2]?.permission, 'auto');
  const signal = AbortSignal.timeout(3_000);
  await tools[0]!.execute({ url: 'http://example.com/' }, toolContext('open', { signal }));
  assert.ok(fake.commands.some((c) => c.method === 'Page.navigate'));
  assert.match(await tools[1]!.execute({}, toolContext('read', { signal })), /可读的页面/);
  await tools[2]!.execute({ action: { kind: 'click', x: 1, y: 1 } }, toolContext('click', { signal }));
  assert.equal(fake.commands.some((c) => c.method === 'Input.dispatchMouseEvent'), true);
});

test('脑的一步被用户接手时报错写明「用户接手了」，不当成做完了', async (t) => {
  const fake = await fakeCdp();
  const browser = new CloudBrowser({ transport: new CdpBrowser({ endpoint: fake.endpoint }), now: () => new Date() });
  t.after(async () => { browser.close(); await fake.close(); });
  await browser.userOpen('http://example.com/', AbortSignal.timeout(3_000));
  fake.hold('Input.insertText');
  const result = assert.rejects(createCloudBrowserActTool(browser).execute({ action: { kind: 'type',
    text: '正在发送' } }, toolContext('typing', { signal: AbortSignal.timeout(3_000) })),
  (error: unknown) => /用户接手了/.test(String((error as { content?: string }).content ?? '')));
  for (let i = 0; i < 100 && !fake.commands.some((command) => command.method === 'Input.insertText'); i += 1) {
    await pause(10);
  }
  await browser.userAct({ kind: 'move', x: 10, y: 10 }, AbortSignal.timeout(3_000), 'tab-1');
  await result;
});
