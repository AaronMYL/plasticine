import { ApiError, errorText } from '../errors.ts';
import type { BatchItem, BatchResponse, BatchResult } from '../shared.ts';

/** 假批量也保留请求回执，重试不会把成功项再做一遍。 */
export class FakeBatchReceipts {
  private readonly held = new Map<string, { digest: string; result: Promise<BatchResponse> }>();
  run(input: { requestId: string }, work: () => Promise<BatchResponse>): Promise<BatchResponse> {
    const digest = JSON.stringify(input);
    const found = this.held.get(input.requestId);
    if (found !== undefined) {
      if (found.digest !== digest) return Promise.reject(new ApiError({ kind: 'conflict', status: 409,
        code: 'request_id_reused', message: '这个请求标识已经用在另一项操作上了。' }));
      return found.result;
    }
    const result = work().catch((cause: unknown) => {
      if (!(cause instanceof ApiError) || cause.status === undefined || cause.status >= 500) {
        this.held.delete(input.requestId);
      }
      throw cause;
    });
    this.held.set(input.requestId, { digest, result });
    return result;
  }
}

export async function fakeBatch(items: readonly BatchItem[], titleOf: (item: BatchItem) => Promise<string>,
  apply: (item: BatchItem) => Promise<unknown>): Promise<BatchResponse> {
  const results: BatchResult[] = [];
  const seen = new Set<string>();
  for (const item of items) {
    let title = item.id;
    try {
      const key = `${item.kind}:${item.id}`;
      if (seen.has(key)) throw new Error('同一项重复出现了，只处理第一次。');
      seen.add(key);
      title = await titleOf(item);
      await apply(item);
      results.push({ kind: item.kind, id: item.id, title, ok: true, error: null });
    } catch (cause) { results.push({ kind: item.kind, id: item.id, title, ok: false, error: errorText(cause) }); }
  }
  const succeeded = results.filter((item) => item.ok).length;
  return { results, succeeded, failed: results.length - succeeded };
}

export function checkTrashCount(actual: number, expected: number): void {
  if (actual !== expected) throw new ApiError({ kind: 'conflict', status: 409, code: 'version_conflict',
    message: '最近删除的数量变了，请刷新后重新确认。' });
}
