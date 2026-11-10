import { BatchResponseSchema, EmptyTrashRequestSchema, LibraryBatchRequestSchema, NotesBatchRequestSchema }
  from '../../shared/api/library-batch.ts';
import { runLibraryBatch, trashItems, type LibraryServices } from '../library/index.ts';
import { argsDigest } from '../system/index.ts';
import { ApiError } from './api-error.ts';
import { requireAuth, type RequestContext, type Reply } from './context.ts';
import { readJsonBody } from './http.ts';
import { idempotent } from './idempotency.ts';
import { checkInput } from './validate.ts';

function services(context: RequestContext): LibraryServices {
  return { state: context.deps.state, workspace: context.deps.m5b.artifacts.workspace };
}

function changed(context: RequestContext, notes: boolean): void {
  if (notes) { context.deps.hub.publish({ type: 'note_invalidated', noteId: 'folders' }); }
}

async function batch(context: RequestContext, notes: boolean): Promise<Reply> {
  requireAuth(context);
  const raw = await readJsonBody(context.req);
  const input = notes ? checkInput(NotesBatchRequestSchema, raw, '批量处理笔记')
    : checkInput(LibraryBatchRequestSchema, raw, '批量处理资料');
  return idempotent(context, input.requestId, (afterCommit) => {
    const body = checkInput(BatchResponseSchema, runLibraryBatch(services(context), input), '批量处理结果');
    afterCommit(() => changed(context, notes));
    return { status: 200, body };
  }, { bodyDigest: argsDigest(input) });
}

async function empty(context: RequestContext, notes: boolean): Promise<Reply> {
  requireAuth(context);
  const input = checkInput(EmptyTrashRequestSchema, await readJsonBody(context.req), '清空最近删除');
  return idempotent(context, input.requestId, (afterCommit) => {
    const deps = services(context);
    const items = trashItems(deps, notes);
    if (items.length !== input.expectCount) {
      throw new ApiError(409, 'version_conflict', '最近删除的数量变了，请刷新后重新确认。');
    }
    const body = runLibraryBatch(deps, { action: 'purge', items });
    afterCommit(() => changed(context, notes));
    return { status: 200, body };
  }, { bodyDigest: argsDigest(input) });
}

export const batchLibrary = (context: RequestContext): Promise<Reply> => batch(context, false);
export const batchNotes = (context: RequestContext): Promise<Reply> => batch(context, true);
export const emptyLibrary = (context: RequestContext): Promise<Reply> => empty(context, false);
export const emptyNotes = (context: RequestContext): Promise<Reply> => empty(context, true);
