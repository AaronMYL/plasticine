import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { fauxAssistantMessage } from '@earendil-works/pi-ai';
import { call } from '../../agent/tests/app/helpers.ts';
import { capture, startStack, text, until } from './helpers.ts';
import { reloadPage } from './reload.ts';

for (const client of ['mac', 'phone'] as const) {
  test(`${client}：删除四条后首页即时移除（进最近删除），刷新仍隐藏，通用修复继续显示`, async (t) => {
    const ids: string[] = [];
    const titles = ['接入抖音收藏并生成兴趣相关摘要', '实现抖音收藏来源与只读增量刷新',
      '接续单视频样例：改用AI抖音', '修复AI抖音跨框架读取与提交识别'];
    const stack = await startStack(t, { client, realClock: true, kernel: { connected: true }, hash: '#/today',
      beforeOpen(app) {
        const kernel = app.app.deps.lines!;
        for (const title of titles) {
          const line = kernel.open({ title, goal: '保留的原始要求', projectId: null, parentLineId: null },
            () => undefined);
          kernel.halt(line.id);
          app.state.lineMessages.append(line.id, 'assistant', fauxAssistantMessage('保留的原始成果'));
          ids.push(line.id);
        }
        kernel.open({ title: '通用网页读取修复', goal: '慢慢查网页读取', projectId: null, parentLineId: null });
      },
    });
    const { page, app, cookie } = stack;
    for (const title of titles) await until(page, text(title), title);
    await until(page, text('通用网页读取修复'), '保留通用修复');
    await capture(page, `line-archive-${client}-before`);
    for (const id of ids) {
      const result = await call(app, 'POST', `/v2/lines/${id}/delete`, {
        cookie, body: { requestId: randomUUID() },
      });
      assert.equal(result.status, 200);
    }
    for (const title of titles) await until(page, `!(${text(title)})`, '删除的工作不再显示');
    await until(page, text('通用网页读取修复'), '通用修复保留');
    await reloadPage(page);
    await until(page, text('通用网页读取修复'), '刷新后保留通用修复');
    for (const title of titles) assert.equal(await page.evaluate(text(title)), false);
    for (const id of ids) {
      const read = app.app.deps.lines!.read(id, 50);
      assert.equal(read.queue.length, 0);
      assert.ok(read.messages.some((message) => message.text === '保留的原始成果'));
    }
    await capture(page, `line-archive-${client}-after`);
  });
}
