import assert from 'node:assert/strict';
import { test } from 'node:test';
import { setTimeout as pause } from 'node:timers/promises';
import { fauxAssistantMessage } from '@earendil-works/pi-ai';
import { Mates } from '../../agent/src/mates/service.ts';
import { capture, click, fill, startStack, until } from './helpers.ts';

for (const client of ['mac', 'phone'] as const) {
  for (const theme of ['light', 'dark']) {
    test(`${client} ${theme}：群任务从发布、领取到交付保持同一张卡`, async (t) => {
      let groupId = '';
      let groupLineId = '';
      let mateId = '';
      const { app, page } = await startStack(t, { client, realClock: true, hash: '/plasticine',
        beforeOpen(app) {
          const mates = new Mates(app.state, () => app.app.deps.lines);
          const first = mates.create({ name: '资料研究员', role: '核对原始资料', avatar: '研', hue: 'sky',
            soul: '核实来源，列出结论。', purpose: null });
          const second = mates.create({ name: '文字编辑', role: '校对文字', avatar: '编', hue: 'olive',
            soul: '保留原意。', purpose: null });
          const group = mates.createGroup({ name: '阅读小组', mateIds: [first.id, second.id] });
          groupId = group.id; groupLineId = group.lineId; mateId = first.id;
        } });
      await until(page, `(() => {
        const link = document.querySelector('a[href="#/plasticine/group/${groupId}"]');
        link?.click(); return link !== null;
      })()`, '打开阅读小组');
      await page.evaluate(`document.documentElement.dataset.theme = ${JSON.stringify(theme)}`);
      await click(page, '分工');
      await click(page, '发布任务');
      const goal = '核对阅读提纲\n读完两段资料，再给三点结论。';
      await fill(page, '.mate-editor-sheet textarea', goal);
      await click(page, '发布任务', 'document.querySelector(".mate-editor-sheet")');
      await until(page, `document.querySelector('[aria-label="群组分工"]')?.textContent.includes('全群待领')`,
        '待领取任务卡');
      const tasks = app.state.lines.list({ parentLineId: groupLineId, kind: 'background', limit: 20 });
      assert.equal(tasks.length, 1);
      const task = tasks[0]!;
      assert.equal(task.mateId, null);
      assert.equal(task.status, 'paused');
      await pause(200);
      await capture(page, `mate-task-waiting-${client}-${theme}`);
      const answer = '第一点：来源已经核对。\n\n' + '资料中的三个结论与对应段落一致。'.repeat(25)
        + '\n\n最后一点：下一步可以进入文字校对。';
      app.respond([fauxAssistantMessage(answer)]);
      await click(page, '选择领取队友', 'document.querySelector("[aria-label=群组分工]")');
      await click(page, '资料研究员领取');
      await until(page, `document.querySelector('[aria-label="群组分工"]')?.textContent.includes('已交付')`,
        '同一张任务卡完成交付');
      await until(page, `document.querySelector('[aria-label="群组分工"]')?.textContent
        .includes('最后一点：下一步可以进入文字校对。')`, '完整交付末段');
      const finished = app.state.lines.require(task.id);
      assert.equal(finished.mateId, mateId);
      assert.equal(finished.status, 'idle');
      assert.equal(app.state.lines.list({ parentLineId: groupLineId, kind: 'background', limit: 20 }).length, 1);
      const report = app.state.lineMessages.after(groupLineId, 0).find((message) => message.role === 'lineReport');
      assert.ok(report);
      assert.equal(Reflect.get(report.message as object, 'text'), answer);
      assert.equal(await page.evaluate('document.documentElement.scrollWidth > innerWidth'), false);
      await pause(200);
      await capture(page, `mate-task-delivered-${client}-${theme}`);
      await page.send('Page.reload');
      await until(page, `document.body.textContent.includes('核对阅读提纲')`, '刷新仍保留任务卡');
      assert.equal(app.state.lines.require(task.id).mateId, mateId);
    });
  }
}
