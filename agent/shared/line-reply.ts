// 「回复某一条」（《优化清单》第 17 条借鉴 Muse）：他这句针对线里的哪一条。服务端把那一条的作者和开头写成一行记号
// 放在这句话最前面（排队、立即发送、重启都跟着这句话走，不另存一列）；模型读到的是这一行，界面把它拆出来画成
// 气泡上方的「回复 Plasticine：……」。

import { Type, type Static } from 'typebox';

export const LineReplySchema = Type.Object({
  seq: Type.Integer({ minimum: 1 }),
  /** 那一条是谁说的：Plasticine 或「你」。 */
  author: Type.String(),
  /** 那一条的开头（一行）。 */
  text: Type.String(),
}, { additionalProperties: false });
export type LineReply = Static<typeof LineReplySchema>;

/** 记号里那一条的开头最多这么长：气泡上一行放得下。 */
export const REPLY_EXCERPT_CHARS = 40;
const MARK = /^［回复(.+?)（第 (\d+) 条）：「([^\n]*)」］\n/;

/** 一行的开头：第一行非空的字，过长截断加省略号。 */
export function replyExcerpt(text: string): string {
  const first = text.split('\n').map((line) => line.replace(/[#>*`_]/g, '').trim()).find((line) => line !== '') ?? '';
  const chars = Array.from(first);
  return chars.length <= REPLY_EXCERPT_CHARS ? first : `${chars.slice(0, REPLY_EXCERPT_CHARS).join('')}…`;
}

export function replyMarker(reply: LineReply): string {
  return `［回复${reply.author}（第 ${reply.seq} 条）：「${reply.text.replace(/\n/g, ' ')}」］\n`;
}

/** 把开头的回复记号拆出来；没有记号原样返回。 */
export function splitReply(text: string): { replyTo: LineReply | null; text: string } {
  const match = MARK.exec(text);
  if (match === null || match[1] === undefined || match[2] === undefined || match[3] === undefined) {
    return { replyTo: null, text };
  }
  return { replyTo: { author: match[1], seq: Number(match[2]), text: match[3] }, text: text.slice(match[0].length) };
}
