// 第三级：翻对话（第 17 条：完整对话永久保存，模型要原话时按关键词、日期查原文；《优化清单》第 20 条：和 ⌘K 用同一个
// 统一全文索引）。只读：所有线（主线、旁聊、后台线）上他和 Plasticine 说的话，工具结果和委派原文不在里面。
// 返回每条命中的引用（line:<线>:<seq>，记忆锚点同一种写法）、时间、所在线和命中处前后一小段原文。

import type { AgentTool } from '@earendil-works/pi-agent-core';
import { ConversationSearchParameters, type IndexLineKind } from '../../shared/search-index.ts';
import { dayRange } from '../daily/index.ts';
import type { StateService } from '../state/index.ts';
import { DEFAULT_TIME_ZONE } from './kernel-types.ts';
import { checkedArgs } from './tool-args.ts';
import type { KernelTool } from './types.ts';

const TOOL_NAME = 'conversation_search';
// 一次默认列这么多条：够挑出要的那句，不把整段历史塞回上下文。
const DEFAULT_HITS = 8;
// 命中处前后各留这么多字。
const SNIPPET_SIDE_CHARS = 60;

const LINE_KIND_LABELS: Readonly<Record<IndexLineKind, string>> = {
  main: '主线', side: '旁聊', background: '后台线',
};

export type ConversationSearchState = Pick<StateService, 'search' | 'lines'>;

/** 命中处前后一小段，压成一行。找不到命中位置（比如大小写折叠不同）就取开头。 */
export function snippetAround(text: string, query: string): string {
  const chars = Array.from(text.replace(/\s+/gu, ' ').trim());
  const lower = chars.map((char) => char.toLocaleLowerCase());
  const needle = Array.from(query.trim().toLocaleLowerCase());
  let index = 0;
  for (let at = 0; at + needle.length <= lower.length; at += 1) {
    if (needle.every((char, offset) => lower[at + offset] === char)) {
      index = at;
      break;
    }
  }
  const start = Math.max(0, index - SNIPPET_SIDE_CHARS);
  const end = Math.min(chars.length, index + needle.length + SNIPPET_SIDE_CHARS);
  return `${start > 0 ? '…' : ''}${chars.slice(start, end).join('')}${end < chars.length ? '…' : ''}`;
}

function localStamp(iso: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: DEFAULT_TIME_ZONE, year: 'numeric', month: '2-digit',
    day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(iso));
  const part = (type: string): string => parts.find((entry) => entry.type === type)?.value ?? '';
  return `${part('year')}-${part('month')}-${part('day')} ${part('hour')}:${part('minute')}`;
}

function createConversationSearch(state: ConversationSearchState): AgentTool<typeof ConversationSearchParameters> {
  return {
    name: TOOL_NAME,
    label: '翻对话',
    description: 'Finds his and your own exact earlier words in every line (main, side, background), by keyword and '
      + 'optionally by day range (YYYY-MM-DD, his time zone) and line kind. Returns each hit\'s ref '
      + '(line:<line>:<seq>), time, line, and a short stretch of the original text around the hit, best match '
      + 'first. Use it when you need what was actually said rather than a summary. Tool results are not included.',
    parameters: ConversationSearchParameters,
    async execute(_toolCallId, raw) {
      const args = checkedArgs(ConversationSearchParameters, raw, TOOL_NAME);
      const from = args.from === undefined ? undefined : dayRange(args.from, DEFAULT_TIME_ZONE).start.toISOString();
      const before = args.to === undefined ? undefined : dayRange(args.to, DEFAULT_TIME_ZONE).end.toISOString();
      const hits = state.search.find({ q: args.query, kinds: ['message'],
        ...(args.lineKind === undefined ? {} : { lineKinds: [args.lineKind] }),
        ...(from === undefined ? {} : { from }), ...(before === undefined ? {} : { before }) });
      if (hits.length === 0) {
        return { content: [{ type: 'text', text: `没找到含「${args.query}」的原话。` }], details: {} };
      }
      const shown = hits.slice(0, args.limit ?? DEFAULT_HITS);
      const titles = new Map<string, string>();
      const rows = shown.map((hit) => {
        const lineId = hit.lineId ?? '';
        if (!titles.has(lineId)) {
          titles.set(lineId, state.lines.get(lineId)?.title ?? lineId);
        }
        const where = `${titles.get(lineId)}（${hit.lineKind === null ? '线' : LINE_KIND_LABELS[hit.lineKind]}）`;
        return `[${hit.ref}] ${localStamp(hit.updatedAt)} · ${where} · ${hit.detail}：${snippetAround(hit.body,
          args.query)}`;
      });
      const head = hits.length > shown.length ? `找到 ${hits.length} 条，最相关的 ${shown.length} 条：`
        : `找到 ${hits.length} 条：`;
      return { content: [{ type: 'text', text: [head, ...rows].join('\n') }], details: {} };
    },
  };
}

export function conversationSearchTool(state: ConversationSearchState): KernelTool {
  return {
    name: TOOL_NAME,
    say: (args) => (typeof args['query'] === 'string' ? `翻对话：${args['query']}` : '翻对话'),
    hardLine: () => null,
    create: () => createConversationSearch(state),
  };
}
