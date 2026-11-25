// SPDX-License-Identifier: Apache-2.0

import { Type, type Static } from 'typebox';

export const LineReplySchema = Type.Object({
  seq: Type.Integer({ minimum: 1 }),
  author: Type.String(),
  text: Type.String(),
}, { additionalProperties: false });
export type LineReply = Static<typeof LineReplySchema>;

export const REPLY_EXCERPT_CHARS = 40;
const MARK = /^［回复(.+?)（第 (\d+) 条）：「([^\n]*)」］\n/;

export function replyExcerpt(text: string): string {
  const first = text.split('\n').map((line) => line.replace(/[#>*`_]/g, '').trim()).find((line) => line !== '') ?? '';
  const chars = Array.from(first);
  return chars.length <= REPLY_EXCERPT_CHARS ? first : `${chars.slice(0, REPLY_EXCERPT_CHARS).join('')}…`;
}

export function replyMarker(reply: LineReply): string {
  return `［回复${reply.author}（第 ${reply.seq} 条）：「${reply.text.replace(/\n/g, ' ')}」］\n`;
}

export function splitReply(text: string): { replyTo: LineReply | null; text: string } {
  const match = MARK.exec(text);
  if (match === null || match[1] === undefined || match[2] === undefined || match[3] === undefined) {
    return { replyTo: null, text };
  }
  return { replyTo: { author: match[1], seq: Number(match[2]), text: match[3] }, text: text.slice(match[0].length) };
}
