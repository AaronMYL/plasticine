// 大块的工具结果不进上下文（《优化清单》第 17 条）：网页全文、长日志只在库里存一份，送给模型时只放开头和取全文的
// 引用；要用时用 read_result 按段取。库里的消息原样不动，界面照旧读库。

import { Type } from 'typebox';
import type { AgentTool } from '@earendil-works/pi-agent-core';
import type { ToolResultMessage } from '@earendil-works/pi-ai';
import type { StateService } from '../state/index.ts';
import { lineRef } from '../state/index.ts';
import { contentText } from './messages.ts';
import { checkedArgs } from './tool-args.ts';
import type { KernelTool } from './types.ts';

/** 结果超过这么多字就只放开头：约一两千 token，一页网页全文远超这个。 */
export const LARGE_RESULT_CHARS = 8_000;
/** 放进上下文的开头这么长：够判断要不要再取。 */
export const RESULT_HEAD_CHARS = 1_500;
/** read_result 一次最多取这么多：小于上面的门槛，取回来的那段本身不会再被截。 */
export const RESULT_PAGE_CHARS = 6_000;
export const READ_RESULT_TOOL = 'read_result';

/** 送给模型的样子：超长的文字换成开头 + 引用；图原样。没超原样返回。 */
export function clipLargeResult(message: ToolResultMessage, lineId: string, seq: number): ToolResultMessage {
  const text = contentText(message.content);
  const chars = Array.from(text);
  if (chars.length <= LARGE_RESULT_CHARS) {
    return message;
  }
  const head = chars.slice(0, RESULT_HEAD_CHARS).join('');
  const note = `\n\n［这一步的结果有 ${chars.length} 字，上面只是开头；全文存着，要用时调 ${READ_RESULT_TOOL}`
    + `（ref: ${lineRef(lineId, seq)}，offset 从 ${RESULT_HEAD_CHARS} 起）按段取］`;
  const images = message.content.filter((part) => part.type !== 'text');
  return { ...message, content: [{ type: 'text', text: `${head}${note}` }, ...images] };
}

const ReadParameters = Type.Object({
  ref: Type.String({ minLength: 1, description: 'The ref from the clipped result, line:<lineId>:<seq>' }),
  offset: Type.Optional(Type.Integer({ minimum: 0, description: 'Character offset to start from' })),
  limit: Type.Optional(Type.Integer({ minimum: 1, maximum: RESULT_PAGE_CHARS })),
}, { additionalProperties: false });

export type ResultState = Pick<StateService, 'lineMessages'>;

function createRead(state: ResultState): AgentTool<typeof ReadParameters> {
  return {
    name: READ_RESULT_TOOL,
    label: '取一步结果的全文',
    description: '取回一步工具结果的全文（上下文里只放了开头的那种）：按 offset 分段读，一次最多 '
      + `${RESULT_PAGE_CHARS} 字。`,
    parameters: ReadParameters,
    replay: 'safe',
    async execute(_id, raw) {
      const args = checkedArgs(ReadParameters, raw, READ_RESULT_TOOL);
      const said = state.lineMessages.said(args.ref);
      if (said === undefined || said.role !== 'toolResult') {
        throw new Error(`没有这一步的结果：${args.ref}。用上下文里给的那个 ref。`);
      }
      const chars = Array.from(said.text);
      const offset = Math.min(args.offset ?? 0, chars.length);
      const end = Math.min(chars.length, offset + (args.limit ?? RESULT_PAGE_CHARS));
      const rest = chars.length - end;
      const tail = rest > 0 ? `\n\n［还剩 ${rest} 字，接着读 offset ${end}］` : '\n\n［读完了］';
      return { content: [{ type: 'text', text: `${chars.slice(offset, end).join('')}${tail}` }], details: {} };
    },
  };
}

export function readResultTool(state: ResultState): KernelTool {
  return { name: READ_RESULT_TOOL, say: () => '翻出一步的全文', hardLine: () => null,
    create: () => createRead(state) };
}
