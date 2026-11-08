import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { setTimeout as pause } from 'node:timers/promises';
import { createServer } from 'vite';
import { launchBrowser, type Cdp } from '../../scripts/browser/cdp.ts';
import { pair, startTestApp } from '../../agent/tests/app/helpers.ts';
import { TextModelError } from '../../agent/src/kernel/index.ts';
import { FeedFetcher } from '../../agent/src/daily/index.ts';
import type { FeedSelectionInput } from '../../agent/shared/feed-selection.ts';

async function until(done: () => boolean | Promise<boolean>, label: string): Promise<void> {
  const deadline = Date.now() + 12_000;
  while (!await done()) {
    if (Date.now() > deadline) { throw new Error(`信息流浏览器等待失败：${label}`); }
    await pause(25);
  }
}
async function click(page: Cdp, text: string, scope = 'document'): Promise<void> {
  const selector = `Array.from(${scope}.querySelectorAll('button'))
    .find(b => (b.getAttribute('aria-label') || b.textContent.trim()) === ${JSON.stringify(text)})`;
  await until(() => page.evaluate(`Boolean(${scope}) && Boolean(${selector})`), text);
  await page.evaluate(`${selector}.click()`);
}
async function fill(page: Cdp, selector: string, value: string): Promise<void> {
  await page.evaluate(`(() => {
    const el = document.querySelector(${JSON.stringify(selector)});
    const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, ${JSON.stringify(value)});
    el.dispatchEvent(new Event('input', { bubbles: true }));
  })()`);
}
async function screenshots(page: Cdp, prefix: string, target: string): Promise<void> {
  const directory = process.env['PLASTICINE_BROWSER_EVIDENCE'];
  if (directory === undefined) { return; }
  await mkdir(directory, { recursive: true });
  for (const [width, height] of [[1440, 900], [768, 1024], [390, 844], [500, 500]]) {
    for (const theme of ['light', 'dark']) {
      await page.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
      await page.evaluate(`document.documentElement.dataset.theme = ${JSON.stringify(theme)}`);
      await page.evaluate(`document.querySelector(${JSON.stringify(target)}).scrollIntoView({ block: 'start' })`);
      await pause(80);
      assert.equal(await page.evaluate('document.documentElement.scrollWidth > innerWidth'), false);
      const shot = await page.send('Page.captureScreenshot', { format: 'png' });
      await writeFile(join(directory, `${prefix}-${width}-${theme}.png`), Buffer.from(String(shot['data']), 'base64'));
    }
  }
  await page.send('Emulation.setDeviceMetricsOverride', {
    width: 1440, height: 900, deviceScaleFactor: 1, mobile: false,
  });
}

test('E53–59/70：真实刷新、语义归属、收藏、评论失败接续、旧评论、加关注点/屏蔽与引用', async (t) => {
  let finishFetch: (() => void) | undefined;
  const fetchGate = new Promise<void>((resolve) => { finishFetch = resolve; });
  let commentCalls = 0;
  const app = await startTestApp([async (request) => {
    const user = request.messages.find((row) => row.role === 'user');
    assert.ok(user !== undefined);
    const input = JSON.parse(user.content) as FeedSelectionInput | { text: string };
    if ('candidates' in input) {
      return { complete: true, text: JSON.stringify({ items: input.candidates.map((row) => ({ id: row.id,
        sourceId: input.interests.find((source) => source.label === (row.title.includes('金融') ? '金融'
          : '效率工具'))!.id,
        summary: '按实际内容核对主题的摘要。', why: '与你的关注点有关。', event: row.id })) }) };
    }
    commentCalls += 1;
    if (commentCalls === 1) {
      throw new TextModelError('quota', '隔离测试：额度不足');
    }
    return { complete: true, text: JSON.stringify({ text: '这条可以继续观察实际用途。', level: 'more' }) };
  }], { startTasks: false, feedFetcher: new FeedFetcher({ request: async () => {
    await fetchGate;
    return new Response('<rss><channel><item><title>新型政策性金融工具</title>'
      + '<link>https://example.test/?p=123</link><pubDate>2026-10-27T07:00:00Z</pubDate></item>'
      + '<item><title>工具快捷操作</title><link>https://example.test/a/1</link>'
      + '<pubDate>2026-10-27T07:00:00Z</pubDate></item></channel></rss>');
  } }) });
  t.after(async () => { finishFetch?.(); await app.close(); });
  const tools = app.state.feedSources.create({ kind: 'interest', label: '效率工具', level: 'normal' });
  const finance = app.state.feedSources.create({ kind: 'interest', label: '金融' });
  app.state.feedItems.add({ sourceId: tools.id, origin: 'feed', title: '已有条目',
    day: '2026-10-26', arrivedAt: '2026-10-26T01:00:00Z', dedupeKey: 'browser-existing' },
  { migratedDefault: true, legacyPayload: { row: { comments: [
    { id: 'old-user', by: 'user', text: '旧评论的原话', at: '2026-10-26T01:05:00Z' },
    { id: 'old-ai', by: 'ai', text: '旧版接上的一句', at: '2026-10-26T01:06:00Z' },
  ] } } });
  const vite = await createServer({ root: fileURLToPath(new URL('..', import.meta.url)), logLevel: 'error',
    server: { hmr: false, host: '127.0.0.1', port: 0, proxy: { '/v2': { target: app.base } } } });
  await vite.listen();
  t.after(async () => { await vite.close(); });
  const address = vite.httpServer?.address();
  assert.ok(address !== null && typeof address === 'object');
  const base = `http://127.0.0.1:${address.port}`;
  const browser = await launchBrowser();
  t.after(async () => { await browser.close(); });
  const page = await browser.page(`${base}/browser-tests/fixtures/feed.html#/feed`);
  const [name, value] = (await pair(app)).split('=');
  await page.send('Network.setCookie', { name, value, url: base });
  await page.send('Emulation.setDeviceMetricsOverride', {
    width: 1440, height: 900, deviceScaleFactor: 1, mobile: false,
  });
  await page.send('Page.reload');
  // 刚重载时 body 可能还没有：等它出来再看文字，别把空页当脚本错误。
  await until(() => page.evaluate(`document.body?.textContent.includes('已有条目') === true`), '已有条目');
  // 第 3 批起信息流页没有手动「刷新」（订阅每 2 小时入库，关注点每天搜一次）；这里照旧走真实 POST /refresh，
  // 核对语义归属和入库后页面自己读到新条目。
  const refreshed = page.evaluate<{ status: string; added: number }>(`(async () => {
    const requestId = crypto.randomUUID();
    let run = await fetch('/v2/feed/refresh', { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ requestId }) }).then((response) => response.json());
    while (run.status === 'running' || run.status === 'queued') {
      await new Promise((resolve) => setTimeout(resolve, 100));
      run = await fetch('/v2/feed/refresh/' + requestId).then((response) => response.json());
    }
    return run;
  })()`);
  await pause(200);
  assert.ok(await page.evaluate(`document.body.textContent.includes('已有条目')`));
  finishFetch?.();
  const run = await refreshed;
  assert.equal(run.status, 'completed'); assert.equal(run.added, 2);
  const financial = app.state.feedItems.page({}, {}).find((item) => item.title.includes('金融工具'))!;
  assert.equal(financial.sourceId, finance.id);
  assert.equal(financial.url, 'https://example.test/?p=123');
  const toolItem = app.state.feedItems.page({}, {}).find((item) => item.title === '工具快捷操作')!;
  const card = `document.querySelector('.feed-board [role="listitem"][aria-label="工具快捷操作"]')`;
  await until(() => page.evaluate(`Boolean(${card})`), '新条目进了瀑布流');
  await click(page, '收藏', card);
  // 收藏归信息流（11-04），页头分段「收藏」只看收藏的。
  await until(() => app.state.feedItems.page({}, {}).some((item) => item.id === toolItem.id && item.savedAt !== null),
    '收藏落盘');
  await click(page, '收藏', `document.querySelector('[role="group"][aria-label="信息流来自哪里"]')`);
  await until(() => page.evaluate(`document.querySelectorAll('.feed-board [role="listitem"]').length === 1`), '只看收藏');
  // 记想法、评论在这一条的直达页（#/feed/<id>，第 3 批）。
  await page.evaluate(`location.hash = '#/feed/${toolItem.id}'`);
  await until(() => page.evaluate(`Boolean(document.querySelector('.feed-comments textarea'))`), '直达页的评论');
  const comments = `document.querySelector('.feed-comments')`;
  await fill(page, '.feed-comments textarea', '这个关注点以后多推一点');
  await click(page, '发送评论', comments);
  await until(() => page.evaluate(`document.body.textContent.includes('额度')`), '具体回复失败');
  await click(page, '重试这次回复', comments);
  await until(() => page.evaluate(`document.body.textContent.includes('已调为多推')`), '只接续这次回复');
  assert.equal(app.state.feedSources.require(tools.id).level, 'more');
  assert.equal(app.app.deps.daily.comments!.list(toolItem.id).length, 2);
  await click(page, '问 Plasticine', `document.querySelector('[aria-label="直达的信息"]')`);
  await until(() => page.evaluate(`Boolean(document.querySelector('.line-quotes'))`), '带入引用');
  await screenshots(page, 'feed-comments', '.feed-comments');
  const existing = app.state.feedItems.page({}, {}).find((item) => item.title === '已有条目')!;
  await page.evaluate(`location.hash = '#/feed/${existing.id}'`);
  await until(() => page.evaluate(`document.body.textContent.includes('旧版接上的一句')`), '旧双方评论');
  // 关注点和屏蔽的网站在页头「加来源」打开的 Sheet 里（第 3 批，以前叫「信息源」）。
  await page.evaluate(`location.hash = '#/feed'`);
  await click(page, '加来源');
  await click(page, '加关注点');
  await until(() => page.evaluate(`Boolean(document.querySelector('.feed-interest input[maxlength="200"]'))`), '关注点表单');
  await fill(page, '.feed-interest input[maxlength="200"]', '学习方法');
  await fill(page, '.feed-interest input[maxlength="500"]', '学习 认知');
  await click(page, '添加关注点');
  await until(() => app.state.feedSources.all().some((source) => source.label === '学习方法'), '新关注点');
  await click(page, '屏蔽', `document.querySelector('.feed-sites')`);
  await until(() => app.state.feedSources.all({ kind: 'blocked_site' })[0]?.level === 'off', '站点屏蔽');
  await click(page, '恢复', `document.querySelector('.feed-sites')`);
  await until(() => app.state.feedSources.all({ kind: 'blocked_site' })[0]?.level === 'normal', '站点恢复');
  await screenshots(page, 'feed-sources', '[aria-label="信息源"]');
  // 首页的「今日数字」（记账 · 日程 · 专注）第 2 批去掉了，工具在新标签页里；这一段不再验。
});
