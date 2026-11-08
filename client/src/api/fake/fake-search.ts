import { searchDocuments, SearchQueryError, type SearchDocument } from '../../../../agent/shared/search.ts';
import type { SearchApi } from '../client.ts';
import { ApiError } from '../errors.ts';
import type { SearchKind, SearchQuery, SearchResponse } from '../shared.ts';
import type { FakeNotes } from './fake-notes.ts';
import type { FakeMemoryTopics } from './fake-memory-topics.ts';
import type { FakeAgreements } from './fake-agreements.ts';
import type { FakeFeed } from './fake-feed.ts';
import { MAIN_LINE_ID, type FakeLines } from './fake-lines.ts';
import type { FakeSession } from './fake-session.ts';
import type { FakeBookmarks } from './fake-bookmarks.ts';
import type { FakeBooks } from './fake-books.ts';
import type { FakeSpaces } from './fake-spaces.ts';

interface Deps {
  session: FakeSession; notes: FakeNotes; lines: FakeLines; memoryTopics: FakeMemoryTopics;
  agreements: FakeAgreements; feed: FakeFeed; now: () => Date; bookmarks: FakeBookmarks;
  spaces: FakeSpaces; books: FakeBooks;
}
const doc = (kind: SearchKind, row: { id: string; updatedAt: string }, title: string, text: string,
  detail = ''): SearchDocument => ({ kind, id: row.id, updatedAt: row.updatedAt, title, text, detail });

export class FakeSearch implements SearchApi {
  private readonly deps: Deps;
  constructor(deps: Deps) { this.deps = deps; }

  private *documents(): Generator<SearchDocument> {
    const d = this.deps;
    for (const row of d.notes.backupSnapshots()) if (row.deletedAt === null) {
      yield doc('note', row, row.title, row.markdown, row.folder);
    }
    // 对话（和真服务端 state/search.ts 一样）：id 是 line:<线>:<seq>，带上线的种类，点开回到那条线。
    for (const line of d.lines.allLines()) {
      for (const row of d.lines.messagesOf(line.id)) {
        if ((row.role !== 'user' && row.role !== 'assistant') || row.text.trim() === '') continue;
        yield { ...doc('message', { id: `line:${row.lineId}:${row.seq}`, updatedAt: row.createdAt },
          row.text.split('\n', 1)[0] ?? '', row.text, row.role === 'user' ? '你' : 'Plasticine'),
        lineKind: line.id === MAIN_LINE_ID ? 'main' : line.kind };
      }
    }
    for (const row of d.memoryTopics.searchable()) {
      yield doc('memory_doc', row, row.title, row.text, '记忆');
    }
    for (const row of d.agreements.all()) yield doc(row.kind === 'term' ? 'term' : 'agreement', row,
      row.title || row.text, `${row.text}\n${row.scope}\n${row.userQuote ?? ''}`);
    for (const row of d.feed.all()) if (row.reaction !== 'dislike') {
      yield doc('feed_item', { id: row.id, updatedAt: row.arrivedAt }, row.title,
        `${row.summary ?? ''}\n${row.why ?? ''}\n${row.note ?? ''}\n${row.topic ?? ''}`);
    }
    for (const row of d.bookmarks.searchable()) {
      yield doc('bookmark', row, row.title, row.text, row.detail);
    }
    for (const row of d.spaces.searchable()) yield doc('space', row, row.title, row.text, '空间');
    for (const row of d.books.searchable()) yield doc('book', row, row.title, row.text, '图书');
  }

  async query(input: SearchQuery, signal?: AbortSignal): Promise<SearchResponse> {
    this.deps.session.require();
    signal?.throwIfAborted();
    try { return searchDocuments(this.documents(), input, this.deps.now().toISOString()); }
    catch (cause) {
      if (cause instanceof SearchQueryError) throw new ApiError({ kind: 'invalid', code: 'invalid_request',
        status: 400, message: cause.message });
      throw cause;
    }
  }
}
