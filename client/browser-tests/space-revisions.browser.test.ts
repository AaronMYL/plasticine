import assert from 'node:assert/strict';
import { test } from 'node:test';
import { setTimeout as pause } from 'node:timers/promises';
import { fauxAssistantMessage, fauxToolCall } from '@earendil-works/pi-ai';
import { EMPTY_SPACE_DOC } from '../../agent/shared/state.ts';
import { capture, click, fill, startStack, until } from './helpers.ts';

for (const client of ['mac', 'phone'] as const) {
  for (const theme of ['light', 'dark']) {
    test(`${client} ${theme}：原处修改产生版本卡，查看差异并回看对应版本`, async (t) => {
      const { app, page } = await startStack(t, { client, realClock: true, hash: '/plasticine' });
      const space = app.state.spaces.create({ title: '阅读进展', author: 'ai', genre: 'report',
        doc: EMPTY_SPACE_DOC, html: '<section id="progress"><h1>阅读进展</h1>'
          + '<p>这周读完两本书，整理了三个问题。</p></section>' });
      app.respond([
        fauxAssistantMessage([fauxToolCall('space_edit', { id: space.id, version: 1, change: '补上阅读数量',
          edits: [{ old_text: '这周读完两本书', new_text: '这周读完三本书' }] }, { id: 'edit-progress-fixture' })],
        { stopReason: 'toolUse' }), fauxAssistantMessage('已在《阅读进展》里改好。'),
      ]);
      if (client === 'phone') {
        await until(page, `(() => { const link = document.querySelector('a[aria-label="Plasticine 主线"]');
          link?.click(); return link !== null; })()`, '打开主线');
      }
      await fill(page, 'textarea[aria-label="问一句"]', '把读完的数量改成三本');
      await click(page, '发送');
      await until(page, `document.querySelector('.space-revision-card')`, '保存后的版本卡');
      await page.evaluate(`document.documentElement.dataset.theme = ${JSON.stringify(theme)}`);
      await pause(80);
      assert.equal(await page.evaluate('document.documentElement.dataset.theme'), theme);
      assert.equal(app.state.spaces.require(space.id).version, 2);
      assert.equal(app.state.spaces.revision(space.id, 2)?.lineId, 'line-main');
      await capture(page, `space-version-card-${client}-${theme}`);
      await click(page, '看改了什么');
      await capture(page, `space-changes-motion-start-${client}-${theme}`);
      await pause(100);
      await capture(page, `space-changes-motion-mid-${client}-${theme}`);
      await until(page, `document.querySelector('.space-change-row ins')?.textContent.includes('三本书')`, '新旧差异');
      await pause(250);
      await capture(page, `space-changes-${client}-${theme}`);
      assert.equal(await page.evaluate('document.documentElement.scrollWidth > innerWidth'), false);
      await click(page, '打开这一版');
      await until(page, `location.hash.includes('/2/2')`, '精确版本入口');
      await until(page, `document.querySelector('.space-history-bar')`, '历史版本状态');
      await pause(500);
      await capture(page, `space-changes-open-${client}-${theme}`);
    });
  }
}
