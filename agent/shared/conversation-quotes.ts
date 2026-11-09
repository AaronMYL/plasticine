// SPDX-License-Identifier: Apache-2.0
// 引用协议和存储格式共用一份。全文由服务端按版本解析；落盘的是实际原文，历史不会随笔记修改而变化。
import { Type, type Static } from 'typebox';
import { Value } from 'typebox/value';
import { IdSchema } from './api/common.ts';

export const CONVERSATION_QUOTE_MAX_COUNT = 8;
export const CONVERSATION_QUOTE_MAX_CHARS = 120_000;
export const QUOTE_HEAD = '> 〔引用〕';
export const NOTE_QUOTE_META_HEAD = '> 〔笔记引用〕';
// 书里划的一段：带书、章和位置，聊天里点引用片能回到原文那一句；这本书的「讨论」也靠它归档。
export const BOOK_QUOTE_META_HEAD = '> 〔书引用〕';

const NoteVersionFields = { noteId: IdSchema, version: Type.Integer({ minimum: 1 }) };
export const NoteQuoteReferenceSchema = Type.Union([
  Type.Object({ ...NoteVersionFields, scope: Type.Literal('full') }, { additionalProperties: false }),
  Type.Object({ ...NoteVersionFields, scope: Type.Literal('selection'),
    // JSON 长度上限允许 UTF-16 代理对；真正的合计上限在解析全文后按 Unicode 字符检查。
    text: Type.String({ minLength: 1, maxLength: CONVERSATION_QUOTE_MAX_CHARS * 2 }) },
  { additionalProperties: false }),
]);
export type NoteQuoteReference = Static<typeof NoteQuoteReferenceSchema>;

export const BookQuoteReferenceSchema = Type.Object({
  bookId: IdSchema,
  chapter: Type.Integer({ minimum: 0 }),
  start: Type.Integer({ minimum: 0 }),
  end: Type.Integer({ minimum: 1 }),
  text: Type.String({ minLength: 1, maxLength: CONVERSATION_QUOTE_MAX_CHARS * 2 }),
}, { additionalProperties: false });
export type BookQuoteReference = Static<typeof BookQuoteReferenceSchema>;

export const ConversationQuoteInputSchema = Type.Union([
  Type.Object({ kind: Type.Literal('book'), bookReference: BookQuoteReferenceSchema },
    { additionalProperties: false }),
  Type.Object({ kind: Type.Literal('note'), noteReference: NoteQuoteReferenceSchema },
    { additionalProperties: false }),
  Type.Object({ kind: Type.Literal('text'), label: Type.String({ maxLength: 1_000 }),
    text: Type.String({ maxLength: CONVERSATION_QUOTE_MAX_CHARS * 2 }) }, { additionalProperties: false }),
]);
export type ConversationQuoteInput = Static<typeof ConversationQuoteInputSchema>;

const NoteQuoteMetadataSchema = Type.Object({
  ...NoteVersionFields,
  scope: Type.Union([Type.Literal('full'), Type.Literal('selection')]),
  characters: Type.Integer({ minimum: 0, maximum: CONVERSATION_QUOTE_MAX_CHARS }),
  lines: Type.Integer({ minimum: 1, maximum: CONVERSATION_QUOTE_MAX_CHARS + 1 }),
}, { additionalProperties: false });
export type NoteQuoteMetadata = Static<typeof NoteQuoteMetadataSchema>;

export interface ResolvedConversationQuote {
  label: string;
  text: string;
  noteReference?: NoteQuoteReference;
  bookReference?: BookQuoteReference;
}

const BookQuoteMetadataSchema = Type.Object({
  bookId: IdSchema,
  chapter: Type.Integer({ minimum: 0 }),
  start: Type.Integer({ minimum: 0 }),
  end: Type.Integer({ minimum: 1 }),
  characters: Type.Integer({ minimum: 0, maximum: CONVERSATION_QUOTE_MAX_CHARS }),
  lines: Type.Integer({ minimum: 1, maximum: CONVERSATION_QUOTE_MAX_CHARS + 1 }),
}, { additionalProperties: false });
export type BookQuoteMetadata = Static<typeof BookQuoteMetadataSchema>;

export function quoteCharacters(text: string): number {
  return Array.from(text).length;
}

/** 超限保留原文并要求用户缩小范围，不自动摘录或删掉后半段。 */
export function quoteLimitMessage(quotes: readonly { text: string }[]): string | null {
  if (quotes.length > CONVERSATION_QUOTE_MAX_COUNT) {
    return `一次最多引用 ${CONVERSATION_QUOTE_MAX_COUNT} 段。请移除部分引用后分次发送。`;
  }
  const count = quotes.reduce((sum, quote) => sum + quoteCharacters(quote.text), 0);
  return count > CONVERSATION_QUOTE_MAX_CHARS
    ? `一次引用合计最多 ${CONVERSATION_QUOTE_MAX_CHARS.toLocaleString('zh-CN')} 字，当前引用超出容量。`
      + '请改用选段或拆分发送；原文没有截断。' : null;
}

export function textQuoteBlock(quote: Pick<ResolvedConversationQuote, 'label' | 'text'>): string {
  const label = quote.label.replace(/[\r\n]+/g, ' ');
  const body = quote.text.split('\n').map((line) => line === '' ? '>' : `> ${line}`);
  return [`${QUOTE_HEAD}${label}`, ...body].join('\n');
}

function bookQuoteBlock(quote: ResolvedConversationQuote, reference: BookQuoteReference): string {
  const lines = quote.text.split('\n');
  const metadata: BookQuoteMetadata = {
    bookId: reference.bookId,
    chapter: reference.chapter,
    start: reference.start,
    end: reference.end,
    characters: quoteCharacters(quote.text),
    lines: lines.length,
  };
  return [`${QUOTE_HEAD}${quote.label.replace(/[\r\n]+/g, ' ')}`,
    `${BOOK_QUOTE_META_HEAD}${JSON.stringify(metadata)}`,
    ...lines.map((line) => line === '' ? '>' : `> ${line}`)].join('\n');
}

function resolvedQuoteBlock(quote: ResolvedConversationQuote): string {
  if (quote.bookReference !== undefined) { return bookQuoteBlock(quote, quote.bookReference); }
  if (quote.noteReference === undefined) { return textQuoteBlock(quote); }
  const { noteId, version, scope } = quote.noteReference;
  const lines = quote.text.split('\n');
  const metadata: NoteQuoteMetadata = { noteId, version, scope,
    characters: quoteCharacters(quote.text), lines: lines.length };
  return [`${QUOTE_HEAD}${quote.label.replace(/[\r\n]+/g, ' ')}`,
    `${NOTE_QUOTE_META_HEAD}${JSON.stringify(metadata)}`,
    ...lines.map((line) => line === '' ? '>' : `> ${line}`)].join('\n');
}

/** 消息和模型上下文共用实际引用快照；没有另外一个可能过期的正文来源。 */
export function withResolvedQuotes(text: string, quotes: readonly ResolvedConversationQuote[]): string {
  if (quotes.length === 0) { return text; }
  const blocks = quotes.map(resolvedQuoteBlock).join('\n\n');
  return text === '' ? blocks : `${blocks}\n\n${text}`;
}

export function noteQuoteMetadata(line: string | undefined): NoteQuoteMetadata | null {
  if (line?.startsWith(NOTE_QUOTE_META_HEAD) !== true) { return null; }
  try {
    const value: unknown = JSON.parse(line.slice(NOTE_QUOTE_META_HEAD.length));
    return Value.Check(NoteQuoteMetadataSchema, value) ? value : null;
  } catch (error) {
    if (error instanceof SyntaxError) { return null; }
    throw error;
  }
}

export function bookQuoteMetadata(line: string | undefined): BookQuoteMetadata | null {
  if (line?.startsWith(BOOK_QUOTE_META_HEAD) !== true) { return null; }
  try {
    const value: unknown = JSON.parse(line.slice(BOOK_QUOTE_META_HEAD.length));
    return Value.Check(BookQuoteMetadataSchema, value) ? value : null;
  } catch (error) {
    if (error instanceof SyntaxError) { return null; }
    throw error;
  }
}
