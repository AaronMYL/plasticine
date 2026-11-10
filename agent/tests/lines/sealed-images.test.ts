import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { fauxAssistantMessage } from '@earendil-works/pi-ai';
import { startKernel } from './helpers.ts';

for (const vision of [true, false]) {
  test(`封闭线图片仅注入本轮上下文：${vision ? '图片模型实际收到图' : '文字模型明确没有收到图'}，原库不复制`, async () => {
    let allowed = '';
    const h = await startKernel({ vision, extra: { contextImages: (lineId) => lineId === allowed
      ? [{ type: 'image', mimeType: 'image/png', data: 'aW1hZ2UtZml4dHVyZQ==' }] : [] } });
    try {
      const secret = Buffer.from('fixture-private-image');
      const global = h.handle.state.attachments.open({ requestId: 'global-image-fixture', name: '私密截图.png',
        mimeType: 'image/png', bytes: secret.length, sha256: createHash('sha256').update(secret).digest('hex') },
      'fixture-owner');
      h.handle.state.attachments.storeBytes(global.id, secret);
      h.handle.state.attachments.finish(global.id, { text: null, truncated: false, error: null });
      let count = 0, text = '';
      h.respond([(context) => {
        const user = context.messages.filter((item) => item.role === 'user').at(-1)!;
        count = typeof user.content === 'string' ? 0 : user.content.filter((part) => part.type === 'image').length;
        text = JSON.stringify(user.content);
        return fauxAssistantMessage('完成。');
      }]);
      allowed = h.kernel.open({ title: '图片聊天',
        goal: `［附件：「私密截图」；id：${global.id}；正文用 attachment_text 读］`,
        projectId: null, parentLineId: null,
        sealedPrompt: '只使用当前聊天提供的材料。' }).id;
      await h.kernel.settled();
      assert.equal(count, vision ? 1 : 0);
      assert.equal(text.includes('当前模型未收到图片输入'), !vision);
      assert.equal(JSON.stringify(h.handle.state.lineMessages.after(allowed, 0))
        .includes('aW1hZ2UtZml4dHVyZQ=='), false);
      h.respond([(context) => {
        assert.equal(JSON.stringify(context.messages).includes('aW1hZ2UtZml4dHVyZQ=='), false);
        return fauxAssistantMessage('完成另一件事。');
      }]);
      h.kernel.open({ title: '另一段聊天', goal: '回复另一位', projectId: null, parentLineId: null,
        sealedPrompt: '另一段聊天。' });
      await h.kernel.settled();
    } finally { await h.close(); }
  });
}
