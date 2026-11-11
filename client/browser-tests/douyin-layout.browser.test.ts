import assert from 'node:assert/strict';
import { test } from 'node:test';
import { capture, click, startStack, until } from './helpers.ts';

for (const client of ['web', 'phone'] as const) {
  for (const theme of ['light', 'dark']) {
    test(`${client} ${theme}：收藏页标题完整显示在主区内`, async (t) => {
      const { page } = await startStack(t, { client, hash: '/feed', kernel: { connected: true } });
      if (client === 'phone') await click(page, '筛选');
      await until(page, `Array.from(document.querySelectorAll('.feed-src-main'))
        .some(e => e.textContent.includes('抖音收藏'))`, '收藏来源');
      await page.evaluate(`Array.from(document.querySelectorAll('.feed-src-main'))
        .find(e => e.textContent.includes('抖音收藏')).click()`);
      await until(page, `document.querySelector('.dy-page')`, '收藏页');
      await page.evaluate(`document.documentElement.dataset.theme = ${JSON.stringify(theme)}`);
      const bounds = await page.evaluate<{ top: number; left: number; right: number; bottom: number;
        mainTop: number; mainLeft: number; mainRight: number; mainBottom: number }>(`(() => {
        const title = document.querySelector('.feed-top-title, .feed .page-head-title h1').getBoundingClientRect();
        const main = document.querySelector('.shell-main').getBoundingClientRect();
        return { top: title.top, left: title.left, right: title.right, bottom: title.bottom,
          mainTop: main.top, mainLeft: main.left, mainRight: main.right, mainBottom: main.bottom };
      })()`);
      assert.ok(bounds.top >= bounds.mainTop, `标题顶部被裁切：${JSON.stringify(bounds)}`);
      assert.ok(bounds.left >= bounds.mainLeft && bounds.right <= bounds.mainRight);
      assert.ok(bounds.bottom <= bounds.mainBottom);
      assert.equal(await page.evaluate('document.documentElement.scrollWidth > innerWidth'), false);
      if (await page.evaluate('Boolean(document.querySelector(".chat-dialog"))')) {
        await click(page, '缩小对话框');
        await until(page, '!document.querySelector(".chat-dialog")', '收起对话框');
      }
      await until(page, `Array.from(document.getAnimations()).every(a => a.playState !== 'running')`, '页面动效结束');
      await capture(page, `douyin-header-${client}-${theme}`);
    });
  }
}
