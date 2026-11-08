// /v2/notes: list, read, create, save with the version the editor started from (409 with the current note when it
// changed meanwhile), delete (only the deletion time is set), and the pictures notes refer to.

import {
  CreateNoteRequestSchema,
  DeleteNoteRequestSchema,
  NOTE_LIST_MAX,
  NoteListQuerySchema,
  SaveNoteRequestSchema,
  type NoteListResponse,
  type NoteVersionListResponse,
  type NoteVersionText,
} from '../../shared/api/index.ts';
import { DEFAULT_NOTE_FOLDER, type NotePatch } from '../../shared/state.ts';
import { StateError } from '../state/index.ts';
import { ApiError, notFoundError } from './api-error.ts';
import { param, requireAuth, type Reply, type RequestContext } from './context.ts';
import { readJsonBody } from './http.ts';
import { idempotent } from './idempotency.ts';
import { checkInput, queryObject } from './validate.ts';
import { noteMetaView, noteView } from './views.ts';

/** GET /v2/notes */
export function listNotes(context: RequestContext): Reply {
  requireAuth(context);
  const types = { limit: 'integer', offset: 'integer', includeDeleted: 'boolean', deletedOnly: 'boolean' } as const;
  const query = checkInput(NoteListQuerySchema, queryObject(context.url.searchParams, types), '查询参数');
  const limit = query.limit ?? NOTE_LIST_MAX;
  const offset = query.offset ?? 0;
  const filter = {
    includeDeleted: query.includeDeleted ?? false,
    deletedOnly: query.deletedOnly ?? false,
    q: query.q ?? '',
    ...(query.folder === undefined ? {} : { folder: query.folder }),
  };
  // One more than asked shows whether another page follows.
  const page = context.deps.state.notes.list(filter, { limit: limit + 1, offset });
  const items = page.slice(0, limit);
  const body: NoteListResponse = {
    notes: items.map((note) => {
      const originals = context.deps.state.notes.importDetails.get(note.id).originalIds;
      return { ...noteMetaView(note), mergedCount: originals.length };
    }),
    nextOffset: page.length > limit ? offset + limit : null,
  };
  return { status: 200, body };
}

/** GET /v2/notes/:id — a deleted note is still readable, with deletedAt set. */
export function getNote(context: RequestContext): Reply {
  requireAuth(context);
  const { state } = context.deps;
  const note = state.notes.require(param(context, 'id'));
  return { status: 200, body: noteView(state, note) };
}

/** POST /v2/notes */
export async function createNote(context: RequestContext): Promise<Reply> {
  const auth = requireAuth(context);
  const body = checkInput(CreateNoteRequestSchema, await readJsonBody(context.req), '新笔记');
  const { state } = context.deps;
  return idempotent(context, body.requestId, () => {
    const folder = body.folder ?? DEFAULT_NOTE_FOLDER;
    const note = state.notes.create({ markdown: body.markdown, folder,
      author: auth.actor === 'system' ? 'ai' : 'user' });
    context.deps.hub.publish({ type: 'note_invalidated', noteId: note.id });
    return { status: 201, body: noteView(state, note) };
  });
}

/** PUT /v2/notes/:id */
export async function saveNote(context: RequestContext): Promise<Reply> {
  const auth = requireAuth(context);
  const body = checkInput(SaveNoteRequestSchema, await readJsonBody(context.req), '保存笔记');
  const { state } = context.deps;
  const id = param(context, 'id');
  const patch: NotePatch = {};
  state.notes.require(id);
  if (body.restoredFromVersion !== undefined) {
    patch.restoredFromVersion = body.restoredFromVersion;
  }
  if (body.markdown !== undefined) {
    patch.markdown = body.markdown;
  }
  if (body.folder !== undefined) {
    patch.folder = body.folder;
  }
  if (body.pinned !== undefined) {
    patch.pinned = body.pinned;
  }
  return idempotent(context, body.requestId, () => {
    try {
      const saved = state.notes.saveAs(id, body.version, patch, auth.actor === 'system' ? 'ai' : 'user');
      context.deps.hub.publish({ type: 'note_invalidated', noteId: id });
      return { status: 200, body: noteView(state, saved) };
    } catch (error) {
      if (!(error instanceof StateError) || error.code !== 'version_conflict') {
        throw error;
      }
      const current = state.notes.require(id);
      throw new ApiError(409, 'version_conflict', '这篇笔记在别处改过了，你的改动是基于旧版本的，这次没有保存。', {
        currentVersion: current.version,
        next: '对照 current 里的最新版合并后，用最新的 version 再保存。',
        extra: { current: noteView(state, current) },
      });
    }
  });
}

/** DELETE /v2/notes/:id */
export async function deleteNote(context: RequestContext): Promise<Reply> {
  requireAuth(context);
  const body = checkInput(DeleteNoteRequestSchema, await readJsonBody(context.req), '删除笔记');
  const { state } = context.deps;
  const id = param(context, 'id');
  state.notes.require(id);
  return idempotent(context, body.requestId, () => {
    const deleted = state.notes.markDeleted(id);
    context.deps.hub.publish({ type: 'note_invalidated', noteId: id });
    return { status: 200, body: noteView(state, deleted) };
  });
}

/** GET /v2/notes/:id/versions */
export function listNoteVersions(context: RequestContext): Reply {
  requireAuth(context);
  const { state } = context.deps;
  const id = param(context, 'id');
  state.notes.require(id);
  const versions = state.notes.versions(id).map((row) => ({
    version: row.version,
    bytes: row.bodyBytes,
    characters: Array.from(state.notes.readVersion(id, row.version)?.markdown ?? '').length,
    author: row.author,
    savedAt: row.savedAt,
    restoredFromVersion: row.restoredFromVersion ?? null,
  }));
  const body: NoteVersionListResponse = { versions };
  return { status: 200, body };
}

/** GET /v2/notes/:id/versions/:version */
export function getNoteVersion(context: RequestContext): Reply {
  requireAuth(context);
  context.deps.state.notes.require(param(context, 'id'));
  const version = Number(param(context, 'version'));
  if (!Number.isInteger(version) || version < 1) {
    throw new ApiError(400, 'invalid_request', '版本号要是正整数。', { field: 'version' });
  }
  const found = context.deps.state.notes.readVersion(param(context, 'id'), version);
  if (found === undefined) {
    throw notFoundError('这一版');
  }
  const { version: row, markdown } = found;
  const body: NoteVersionText = {
    version: row.version,
    bytes: row.bodyBytes,
    characters: Array.from(markdown).length,
    author: row.author,
    savedAt: row.savedAt,
    markdown,
    restoredFromVersion: row.restoredFromVersion ?? null,
  };
  return { status: 200, body };
}

/** GET /v2/notes/assets/:name */
export function getNoteAsset(context: RequestContext): Reply {
  requireAuth(context);
  const asset = context.deps.state.notes.readAsset(param(context, 'name'));
  if (asset === undefined) {
    throw notFoundError('这张图');
  }
  return { status: 200, bytes: asset };
}
