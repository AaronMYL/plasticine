import { basename, join } from 'node:path';
import type { BatchItem, BatchRequest, BatchResponse } from '../../shared/api/library-batch.ts';
import { ArtifactError, type Workspace } from '../artifacts/index.ts';
import { allPages, StateError, type StateService } from '../state/index.ts';
import { errorCategory, safeLog } from '../shared-log.ts';

export interface LibraryServices { state: StateService; workspace: Workspace }
export interface BatchCommand {
  action: BatchRequest['action'];
  items: readonly BatchItem[];
  destination?: string;
}

export function trashItems({ state, workspace }: LibraryServices, notes = false): BatchItem[] {
  if (notes) { return allPages((page) => state.notes.list({ deletedOnly: true }, page))
    .map((note) => ({ kind: 'note', id: note.id })); }
  return [
    ...state.spaces.deleted().map((space): BatchItem => ({ kind: 'space', id: space.id })),
    ...state.books.deleted().map((book): BatchItem => ({ kind: 'book', id: book.id })),
    ...workspace.trashed().map((file): BatchItem => ({ kind: workspace.trashDetails(file.id).kind, id: file.id })),
  ];
}

function titleOf(services: LibraryServices, item: BatchItem, action: BatchRequest['action']): string {
  const { state, workspace } = services;
  switch (item.kind) {
    case 'note': return state.notes.require(item.id).title;
    case 'space': return state.spaces.require(item.id).title;
    case 'book': return state.books.require(item.id).title;
    case 'file': case 'folder': return action === 'restore' || action === 'purge'
      ? workspace.trashed().find((entry) => entry.id === item.id)?.name ?? item.id : workspace.stat(item.id).name;
  }
}

function one(services: LibraryServices, item: BatchItem, request: BatchCommand): void {
  const { state, workspace } = services;
  const { action, destination } = request;
  if (action === 'move' && destination === undefined) {
    throw new StateError('invalid_input', '请选择移到哪个文件夹。');
  }
  if (item.kind === 'note') {
    if (action === 'purge') { state.libraryPurge.note(item.id); return; }
    const note = state.notes.require(item.id);
    switch (action) {
      case 'move': state.notes.save(note.id, note.version, { folder: destination ?? '' }); break;
      case 'trash': state.notes.markDeleted(note.id); break;
      case 'restore': state.notes.restore(note.id); break;
    }
    return;
  }
  if (item.kind === 'space') {
    if (action === 'purge') { state.libraryPurge.space(item.id); return; }
    const space = state.spaces.require(item.id);
    switch (action) {
      case 'move': throw new StateError('invalid_input', '这个空间还不能移到文件夹。');
      case 'trash': state.spaces.markDeleted(space.id, space.version); break;
      case 'restore': state.spaces.restore(space.id); break;
    }
    return;
  }
  if (item.kind === 'book') {
    if (action === 'purge') { state.libraryPurge.book(item.id); return; }
    const book = state.books.require(item.id);
    switch (action) {
      case 'move': throw new StateError('invalid_input', '这本书还不能移到文件夹。');
      case 'trash': state.books.update(book.id, book.version, { deletedAt: new Date().toISOString() }); break;
      case 'restore': state.books.update(book.id, book.version, { deletedAt: null }); break;
    }
    return;
  }
  switch (action) {
    case 'move': workspace.move(item.id, join(destination ?? '', basename(item.id)), basename(item.id)); break;
    case 'trash': workspace.trash(item.id, basename(item.id)); break;
    case 'restore': workspace.restore(item.id); break;
    case 'purge': workspace.purge(item.id); break;
  }
}

/** 每项独立收回执；失败项保留身份，客户端能只重试失败的那些。 */
export function runLibraryBatch(services: LibraryServices, request: BatchCommand): BatchResponse {
  const seen = new Set<string>();
  const results = request.items.map((item) => {
    let title = item.id;
    try {
      const key = `${item.kind}:${item.id}`;
      if (seen.has(key)) { throw new StateError('invalid_input', '同一项重复出现了，只处理第一次。'); }
      seen.add(key);
      title = titleOf(services, item, request.action);
      services.state.transaction(() => one(services, item, request));
      return { ...item, title, ok: true, error: null };
    } catch (error) {
      if (error instanceof StateError || error instanceof ArtifactError) {
        return { ...item, title, ok: false, error: error.message };
      }
      safeLog('error', 'library_batch_item_failed', { category: errorCategory(error) });
      return { ...item, title, ok: false, error: '这一项没能处理，请重试。' };
    }
  });
  const succeeded = results.filter((result) => result.ok).length;
  return { results, succeeded, failed: results.length - succeeded };
}
