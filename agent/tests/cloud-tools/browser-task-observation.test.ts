import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CdpBrowser, CloudBrowser } from '../../src/cloud-tools/index.ts';
import { fakeCdp } from './fake-cdp.ts';
import { tempDirectory } from '../state/helpers.ts';

const signal = () => AbortSignal.timeout(3_000);

test('concurrent tasks bind own tabs; observe returns real screenshot/elements, actions reselect tab', async (t) => {
  const fake = await fakeCdp();
  const dir = await tempDirectory();
  const browser = new CloudBrowser({ transport: new CdpBrowser({ endpoint: fake.endpoint }),
    stateDirectory: dir.directory, now: () => new Date() });
  t.after(async () => {
    browser.close();
    await fake.close();
    await dir.cleanup();
  });
  const [first, second] = await Promise.all([
    browser.open('https://example.test/one', signal(), 'task-one'),
    browser.open('https://example.test/two', signal(), 'task-two'),
  ]);
  assert.notEqual(first.activeTabId, second.activeTabId);
  const observation = await browser.observe(signal(), 'task-one');
  assert.equal(observation.tabId, first.activeTabId);
  assert.equal(observation.page.url, 'https://example.test/one');
  assert.equal(observation.page.elements[0]?.text, '编辑');
  assert.equal(observation.image.toString(), 'png');
  await browser.act({ kind: 'click', x: 20, y: 30 }, signal(), 'task-one', observation.id);
  const inputs = fake.commands.filter((command) => command.method === 'Input.dispatchMouseEvent');
  assert.ok(inputs.length > 0);
  assert.ok(inputs.every((command) => command.sessionId === `session-${first.activeTabId}`));
  await browser.text(signal(), 'task-two');
  assert.equal(browser.view().activeTabId, second.activeTabId);
  await assert.rejects(browser.act({ kind: 'click', x: 20, y: 30 }, signal(), 'task-one', observation.id), /重新观察/);
});

test('resumed task reuses original tab with stale frame cleared; user takeover blocks old coords', async (t) => {
  const fake = await fakeCdp();
  const dir = await tempDirectory();
  let browser = new CloudBrowser({ transport: new CdpBrowser({ endpoint: fake.endpoint }),
    stateDirectory: dir.directory, now: () => new Date() });
  t.after(async () => {
    browser.close();
    await fake.close();
    await dir.cleanup();
  });
  const initial = await browser.open('https://example.test/work', signal(), 'task-one');
  const old = await browser.observe(signal(), 'task-one');
  browser.close();
  browser = new CloudBrowser({ transport: new CdpBrowser({ endpoint: fake.endpoint }),
    stateDirectory: dir.directory, now: () => new Date() });
  await assert.rejects(browser.act({ kind: 'click', x: 10, y: 20 }, signal(), 'task-one', old.id), /重新观察/);
  const fresh = await browser.observe(signal(), 'task-one');
  assert.equal(fresh.tabId, initial.activeTabId);
  await browser.userAct({ kind: 'click', x: 4, y: 5 }, signal(), fresh.tabId);
  const before = fake.commands.filter((command) => command.method === 'Input.dispatchMouseEvent').length;
  await assert.rejects(browser.act({ kind: 'click', x: 10, y: 20 }, signal(), 'task-one', fresh.id), /重新观察/);
  assert.equal(fake.commands.filter((command) => command.method === 'Input.dispatchMouseEvent').length, before);
});

test('DOM change rejects stale coords; unbound task must select a real tab or open a URL', async (t) => {
  const fake = await fakeCdp();
  const browser = new CloudBrowser({ transport: new CdpBrowser({ endpoint: fake.endpoint }), now: () => new Date() });
  t.after(async () => {
    browser.close();
    await fake.close();
  });
  await assert.rejects(browser.observe(signal(), 'new-task'), /标签/);
  const initial = await browser.observe(signal(), 'new-task', 'tab-1');
  fake.elementLabel('已变成删除');
  await assert.rejects(browser.act({ kind: 'click', x: 20, y: 30 }, signal(), 'new-task', initial.id), /重新观察/);
  assert.equal(fake.commands.some((command) => command.method === 'Input.dispatchMouseEvent'), false);
  const expression = fake.commands.find((command) => command.method === 'Runtime.evaluate')?.params['expression'];
  assert.ok(typeof expression === 'string');
  assert.doesNotMatch(expression, /\.value\b|document\.cookie|localStorage/);
});
