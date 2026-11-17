import assert from 'node:assert/strict';
import { test } from 'node:test';
import { capture, click, startStack, until } from './helpers.ts';

for (const client of ['web', 'phone'] as const) {
  for (const theme of ['light', 'dark']) {
    test(`${client} ${theme}：抖音收藏页顶上那一行完整显示在主区内`, async (t) => {
      const { page } = await startStack(t, { client, hash: '/feed', kernel: { connected: true } });
      // 11-15 起抖音收藏页不再画只写名字的标题，顶上是「整理到哪了」那一排和同步按钮（douyin-page.tsx）；
      // 电脑上从第二栏的来源进，手机上从「看哪一种」那一排进（原来要先点「筛选」）。
      const source = client === 'phone'
        ? `Array.from(document.querySelectorAll('[aria-label="看哪一种"] .feed-chip'))
          .find(e => e.textContent.trim() === '抖音收藏')`
        : `Array.from(document.querySelectorAll('.feed-src-main')).find(e => e.textContent.includes('抖音收藏'))`;
      await until(page, `Boolean(${source})`, '收藏来源');
      await page.evaluate(`${source}.click()`);
      await until(page, `document.querySelector('.dy-page .dy-index-head')`, '收藏页');
      await page.evaluate(`document.documentElement.dataset.theme = ${JSON.stringify(theme)}`);
      const bounds = await page.evaluate<{ top: number; left: number; right: number; bottom: number;
        mainTop: number; mainLeft: number; mainRight: number; mainBottom: number }>(`(() => {
        const title = document.querySelector('.dy-index-head').getBoundingClientRect();
        const main = document.querySelector('.shell-main').getBoundingClientRect();
        return { top: title.top, left: title.left, right: title.right, bottom: title.bottom,
          mainTop: main.top, mainLeft: main.left, mainRight: main.right, mainBottom: main.bottom };
      })()`);
      assert.ok(bounds.top >= bounds.mainTop, `顶上那一行被裁切：${JSON.stringify(bounds)}`);
      assert.ok(bounds.left >= bounds.mainLeft && bounds.right <= bounds.mainRight);
      assert.ok(bounds.bottom <= bounds.mainBottom);
      assert.equal(await page.evaluate('document.documentElement.scrollWidth > innerWidth'), false);
      if (await page.evaluate('Boolean(document.querySelector(".chat-dialog"))')) {
        await click(page, '缩小对话框');
        await until(page, '!document.querySelector(".chat-dialog")', '收起对话框');
      }
      // 只等按时间播的一次性动效：跟着滚动走的（第二栏的滚动边缘，CSS 滚动时间线）和一直循环的（动态背景）
      // 永远是「在播」，不算。
      await until(page, `Array.from(document.getAnimations()).every(a => a.playState !== 'running'
        || a.timeline !== document.timeline || a.effect?.getComputedTiming().iterations === Infinity)`,
      '页面动效结束');
      await capture(page, `douyin-header-${client}-${theme}`);
    });
  }
}
