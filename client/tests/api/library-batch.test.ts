import { Value } from 'typebox/value';
import { BatchResponseSchema } from '../../src/api/shared.ts';
import { expect, it } from 'vitest';
import { createFakeApi } from '../../src/api/fake/index.ts';
import { createRequestId } from '../../src/api/request-id.ts';

function setup() {
  const fake = createFakeApi({ seed: false, streamStepMs: 0 });
  fake.control.session.signInForDevelopment('测试机');
  return fake;
}
it('笔记批量逐项回执，重复请求不重复处理，永久删除后读不到正文或修订', async () => {
  const { api } = setup();
  const a = await api.notes.create({ requestId: createRequestId(), markdown: '# 示例笔记' });
  const input = { requestId: createRequestId(), action: 'trash' as const,
    items: [{ kind: 'note' as const, id: a.id }, { kind: 'note' as const, id: 'missing' }] };
  const result = await api.notes.batch(input);
  expect(result).toMatchObject({ succeeded: 1, failed: 1 });
  expect(await api.notes.batch(input)).toEqual(result);
  expect(await api.notes.emptyTrash({ requestId: createRequestId(), expectCount: 1 }))
    .toMatchObject({ succeeded: 1, failed: 0 });
  await expect(api.notes.get(a.id)).rejects.toMatchObject({ status: 404 });
});
it('文件夹回收包含文件数，清空数量变化时不删任何项目，重试只处理剩余项', async () => {
  const { api, control } = setup();
  control.m5b.files.seed('示例资料', 'directory');
  control.m5b.files.seed('示例资料/摘要.md');
  const result = await api.library.batch({ requestId: createRequestId(), action: 'trash',
    items: [{ kind: 'folder', id: '示例资料' }] });
  expect(result.succeeded).toBe(1);
  const trash = await api.library.trash();
  expect(trash.items[0]).toMatchObject({ kind: 'folder', fileCount: 1, title: '示例资料' });
  await expect(api.library.emptyTrash({ requestId: createRequestId(), expectCount: 2 }))
    .rejects.toMatchObject({ status: 409 });
  expect((await api.library.trash()).items).toHaveLength(1);
  const emptied = await api.library.emptyTrash({ requestId: createRequestId(), expectCount: 1 });
  expect(Value.Check(BatchResponseSchema, emptied)).toBe(true);
  expect((await api.library.trash()).items).toHaveLength(0);
  expect(control.m5b.files.has('示例资料/摘要.md')).toBe(false);
});
