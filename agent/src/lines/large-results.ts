import { Type } from 'typebox';
import type { AgentTool } from '@earendil-works/pi-agent-core';
import type { ToolResultMessage } from '@earendil-works/pi-ai';
import { lineRef } from '../state/index.ts';
import { accessibleLine, type LineAccessState } from './access.ts';
import { contentText } from './messages.ts';
import { checkedArgs } from './tool-args.ts';
import type { KernelTool, LineScope } from './types.ts';

export const LARGE_RESULT_CHARS = 8_000;
export const RESULT_HEAD_CHARS = 4_000;
export const RESULT_PAGE_CHARS = 6_000;
export const READ_RESULT_TOOL = 'read_result';

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

export type ResultState = LineAccessState;

function createRead(state: ResultState, scope: LineScope): AgentTool<typeof ReadParameters> {
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
      if (said === undefined || said.role !== 'toolResult' || !accessibleLine(state, scope, said.lineId)) {
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
    create: (scope) => createRead(state, scope) };
}
