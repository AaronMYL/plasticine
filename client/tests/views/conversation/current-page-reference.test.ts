import { expect, it } from 'vitest';
import { createFakeApi } from '../../../src/api/fake/index.ts';
import { currentPageReference } from '../../../src/views/conversation/current-page-reference.ts';

it('当前空间只附身份和版本，全文不重复塞进每一轮', async () => {
  const fake = createFakeApi({ seed: true, streamStepMs: 0 });
  const quote = await currentPageReference({ id: 'space', kind: 'page', title: '界面的旧标题', url: null,
    route: { view: 'books', noteId: null, spaceId: 'sp_cog_1' } }, fake.api);
  expect(quote?.text).toContain('space:sp_cog_1@1');
  expect(quote?.text).toContain('#/books/space/sp_cog_1');
  expect(quote?.text).not.toContain('本周读');
  expect(quote?.text.length).toBeLessThan(400);
});
