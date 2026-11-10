import { quoteLimitMessage, withResolvedQuotes, type BookQuoteReference, type ConversationQuoteInput,
  type ResolvedConversationQuote } from '../../shared/conversation-quotes.ts';
import { digestOf, titleOf, type StateService } from '../state/index.ts';
import type { NoteRecord } from '../../shared/state.ts';
import { ApiError } from './api-error.ts';
import { resolveSpaceQuote } from './space-quotes.ts';

function readQuotedVersion(state: StateService, note: NoteRecord, version: number): string {
  try {
    const source = note.version === version ? { version: note, markdown: state.notes.readBody(note) }
      : state.notes.readVersion(note.id, version);
    if (source === undefined) {
      throw new ApiError(409, 'note_quote_version_missing', '找不到引用时的笔记版本，这条消息没有发送。',
        { field: 'quotes', next: '请把消息放回输入框，移除旧引用，再打开笔记重新引用。' });
    }
    const digest = digestOf(source.markdown);
    if (digest.bytes !== source.version.bodyBytes || digest.sha256 !== source.version.bodySha256) {
      throw new ApiError(409, 'note_quote_version_changed', '笔记正文与该版本的记录不一致，这条消息没有发送。',
        { field: 'quotes', next: '请先检查笔记版本或恢复备份，再重新引用；也可以明确复制需要讨论的文字。' });
    }
    return source.markdown;
  } catch (error) {
    if (error instanceof Error && 'code' in error
      && ['ENOENT', 'EACCES', 'EPERM', 'EIO'].includes(String(error.code))) {
      throw new ApiError(409, 'note_quote_unreadable', '暂时读不到引用的笔记正文，这条消息没有发送。',
        { field: 'quotes', next: '请先打开笔记检查正文是否可读，再重新引用；也可以移除这个引用后发送。' });
    }
    throw error;
  }
}

/** 书里划的一段：按位置从章节原文里重新取一遍，取到的和发来的一致才发（防止书换了版本后引用错位）。 */
function resolveBookQuote(state: StateService, reference: BookQuoteReference): ResolvedConversationQuote {
  const book = state.books.get(reference.bookId);
  if (book === undefined || book.deletedAt !== null) {
    throw new ApiError(book === undefined ? 404 : 409, 'book_quote_unavailable',
      '引用的书不在图书馆里了，这条消息没有发送。',
      { field: 'quotes', next: '请把消息放回输入框，移除这个引用后再发。' });
  }
  const chapter = book.toc[reference.chapter];
  const text = chapter === undefined ? undefined
    : state.bookFiles.chapter(book.id, reference.chapter).text.slice(reference.start, reference.end);
  if (text === undefined || text !== reference.text) {
    throw new ApiError(409, 'book_quote_changed', '引用的那段和书里现在的原文对不上，这条消息没有发送。',
      { field: 'quotes', next: '请回到书里重新选中这段，再引用到对话。' });
  }
  return { label: `《${book.title}》${chapter?.title === undefined ? '' : ` ${chapter.title}`}`, text,
    bookReference: reference };
}

function resolveQuote(state: StateService, quote: ConversationQuoteInput): ResolvedConversationQuote {
  if (quote.kind === 'text') { return { label: quote.label, text: quote.text }; }
  if (quote.kind === 'book') { return resolveBookQuote(state, quote.bookReference); }
  if (quote.kind === 'space') { return resolveSpaceQuote(state, quote.spaceReference); }
  const reference = quote.noteReference;
  const note = state.notes.get(reference.noteId);
  if (note === undefined || note.deletedAt !== null) {
    throw new ApiError(note === undefined ? 404 : 409, 'note_quote_unavailable',
      '引用的笔记不存在或已移到回收站，这条消息没有发送。',
      { field: 'quotes', next: '请把消息放回输入框，移除这个引用，或恢复笔记后重新引用。' });
  }
  if (note.private) {
    throw new ApiError(403, 'note_quote_private', '这篇笔记是私密笔记，不能直接引用给对话模型。',
      { field: 'quotes', next: '请移除引用；需要讨论时，明确复制愿意提供的文字到输入框。' });
  }
  const markdown = readQuotedVersion(state, note, reference.version);
  return { label: `《${titleOf(markdown)}》`,
    text: reference.scope === 'full' ? markdown : reference.text, noteReference: reference };
}

/** 在发送事务内解析，先校验所有来源与总量，再创建消息和运行。幂等重放不经过这里。 */
export function resolveConversationQuotes(state: StateService, text: string,
  inputs: readonly ConversationQuoteInput[] = []): string {
  const quotes = inputs.map((input) => resolveQuote(state, input));
  const limit = quoteLimitMessage(quotes);
  if (limit !== null) {
    throw new ApiError(413, 'quote_limit_exceeded', limit, { field: 'quotes' });
  }
  return withResolvedQuotes(text, quotes);
}
