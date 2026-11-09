import {
  DeleteNoteRequestSchema, NOTE_ASSETS_PATH, NOTE_IMAGE_MAX_BYTES, NoteFolderCommandSchema,
  NoteImageRequestSchema, NoteAssistRequestSchema, type NoteAssistRequest, type NoteAssistStreamEvent,
} from '../../shared/api/index.ts';
import { cleanOutboundJson } from '../outbound.ts';
import { errorCategory, safeLog } from '../shared-log.ts';
import { toApiError } from './api-error.ts';
import { param, requireAuth, type HandlerResult, type Reply, type RequestContext } from './context.ts';
import { readJsonBody } from './http.ts';
import { idempotent } from './idempotency.ts';
import { checkInput } from './validate.ts';
import { noteView } from './views.ts';

export function listNoteFolders(context: RequestContext): Reply {
  requireAuth(context);
  return { status: 200, body: context.deps.state.notes.folders.list() };
}

export async function changeNoteFolder(context: RequestContext): Promise<Reply> {
  requireAuth(context);
  const input = checkInput(NoteFolderCommandSchema, await readJsonBody(context.req), '文件夹操作');
  return idempotent(context, input.requestId, () => {
    const { folders } = context.deps.state.notes;
    let body;
    switch (input.action) {
      case 'create': body = folders.create(input.name); break;
      case 'rename': body = folders.rename(input.name, input.next); break;
      case 'move': body = folders.move(input.name, input.direction); break;
      case 'remove': body = folders.remove(input.name, input.destination); break;
    }
    context.deps.hub.publish({ type: 'note_invalidated', noteId: 'folders' });
    return { status: 200, body };
  });
}

export async function restoreNote(context: RequestContext): Promise<Reply> {
  requireAuth(context);
  const input = checkInput(DeleteNoteRequestSchema, await readJsonBody(context.req), '恢复笔记');
  const id = param(context, 'id');
  context.deps.state.notes.require(id);
  return idempotent(context, input.requestId, () => {
    const restored = context.deps.state.notes.restore(id);
    context.deps.hub.publish({ type: 'note_invalidated', noteId: id });
    return { status: 200, body: noteView(context.deps.state, restored) };
  });
}

export async function uploadNoteImage(context: RequestContext): Promise<Reply> {
  requireAuth(context);
  context.deps.state.notes.require(param(context, 'id'));
  // Base64 多占三分之一，另留 JSON 包装大小；实际图片仍由存储层限制为 10 MB。
  const input = checkInput(NoteImageRequestSchema,
    await readJsonBody(context.req, Math.ceil(NOTE_IMAGE_MAX_BYTES / 3) * 4 + 1024), '笔记图片');
  return idempotent(context, input.requestId, () => {
    const saved = context.deps.state.notes.writeAsset(Buffer.from(input.data, 'base64'), input.type);
    return { status: 201, body: { url: `${NOTE_ASSETS_PATH}/${saved.name}`, bytes: saved.bytes } };
  });
}

export function getNoteImport(context: RequestContext): Reply {
  requireAuth(context);
  const state = context.deps.state;
  const note = state.notes.require(param(context, 'id'));
  const details = state.notes.importDetails.get(note.id);
  const ids = [...details.originalIds, ...(details.mergedInto === null ? [] : [details.mergedInto])];
  const links = ids.map((id) => state.notes.require(id)).map((row) => ({
    id: row.id, title: row.title,
  }));
  return { status: 200, body: { ...details, links } };
}

export async function assistNote(context: RequestContext): Promise<HandlerResult> {
  requireAuth(context);
  context.deps.state.notes.require(param(context, 'id'));
  const input = checkInput(NoteAssistRequestSchema, await readJsonBody(context.req), '笔记协作');
  if (input.stream === true) {
    return streamAssist(context, input);
  }
  const controller = new AbortController();
  const abort = (): void => controller.abort();
  context.res.once('close', abort);
  try {
    return { status: 200, body: await context.deps.noteAssistant.suggest(input, controller.signal) };
  } finally {
    context.res.off('close', abort);
  }
}

/**
 * 续写边生成边送（2026-11-09 他定）：和 /v2/events、浏览器画面同一种 SSE 写法，只送给发请求的这一页，不进事件总线
 * （总线是广播加补播缓冲，打字时一秒好几段的增量会挤掉别的事件，也会推到别的设备上）。头等第一段字到了再发：
 * 那之前失败（没连模型、额度用完）照旧回普通的错误回答。页面断开（打字作废、换段）就叫停模型。
 */
async function streamAssist(context: RequestContext, input: NoteAssistRequest): Promise<HandlerResult> {
  const { res } = context;
  const controller = new AbortController();
  const abort = (): void => controller.abort();
  res.once('close', abort);
  let started = false;
  const write = (event: NoteAssistStreamEvent): void => {
    if (controller.signal.aborted || res.writableEnded) {
      return;
    }
    if (!started) {
      started = true;
      res.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-store',
        connection: 'keep-alive', 'x-accel-buffering': 'no' });
    }
    // 出口清洗和普通回答一样（链接里的账号密码）；最终文字在 done 里整段再清一次。
    res.write(`data: ${JSON.stringify(cleanOutboundJson(event))}\n\n`);
  };
  try {
    const view = await context.deps.noteAssistant.suggest(input, controller.signal,
      (delta) => write({ type: 'text', delta }));
    write({ type: 'done', view });
  } catch (error) {
    if (!started) {
      throw error;
    }
    const mapped = toApiError(error);
    if (mapped.unexpected) {
      // 和 server.ts 的错误出口一样只记类别；头已经发出，错误改成流里最后一条。
      safeLog('error', 'request_failed', { category: errorCategory(error) });
    }
    write({ type: 'error', error: mapped.error.body() });
  } finally {
    res.off('close', abort);
  }
  res.end();
  return 'streamed';
}
