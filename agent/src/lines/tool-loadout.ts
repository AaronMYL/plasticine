// 工具面（内核优化第四批，11-17）：一开始只给模型常用的十几件（DIRECT_TOOLS，按线上两周的调用量挑），其余的在系统提示
// 里只列名字；要用时 tool_search 按名字或要做的事找出来，找到的从下一次请求起声明给模型（pi-ai 的 toolsAdded：
// 声明插在对话中间，前面的缓存不动）。能执行的一直是全部工具，所以模型照着名字直接调一件还没声明的也做得了，
// 下一次请求在那一步前面补上声明。声明从库里的记录推出来（tool_search 的结果、调用过的工具），每次请求重装时一样。

import type { AgentMessage, AgentTool } from '@earendil-works/pi-agent-core';
import { toToolDeclaration, type SystemMessage } from '@earendil-works/pi-ai';
import { Type } from 'typebox';
import { checkedArgs } from './tool-args.ts';
import type { KernelTool, LineScope } from './types.ts';

export const TOOL_SEARCH = 'tool_search';
/** 一次最多找出几件。 */
export const SEARCH_LIMIT = 6;

/**
 * 一开始就声明的工具：线上 11-03 至 11-17 调用量最多的（server_command 1,117 次……start_line 30 次），加上问他、
 * 后台线开头列计划的 line_plan（26 次；回放里它放进按需以后，有一件后台线开头没先列计划）。只给某几种线的照样按线的
 * 种类筛：主线、旁聊 20 件，后台线多一件 line_outcome；都再加 tool_search。
 */
export const DIRECT_TOOLS: readonly string[] = [
  'server_command', 'device_action', 'server_command_read', 'read_result', 'read_line', 'tell_line',
  'cloud_browser_observe', 'line_outcome', 'read_memory_doc', 'space_read', 'cloud_browser_open', 'page_send',
  'cloud_browser_act', 'read_project', 'line_wake_later', 'file_save', 'remember', 'start_line', 'skill_read',
  'ask_user', 'line_plan',
];

export interface Loadout {
  /** 一开始声明给模型的。 */
  declared: AgentTool[];
  /** 声明了以后才给模型的（按名字）。 */
  deferred: ReadonlyMap<string, AgentTool>;
}

/** 全部工具分成一开始声明的和按需声明的；direct 不给就是全部一开始声明（测试里的内核）。 */
export function splitLoadout(tools: readonly AgentTool[], direct: ReadonlySet<string> | undefined): Loadout {
  if (direct === undefined) {
    return { declared: [...tools], deferred: new Map() };
  }
  const declared = tools.filter((tool) => direct.has(tool.name) || tool.name === TOOL_SEARCH);
  const deferred = new Map(tools.filter((tool) => !declared.includes(tool)).map((tool) => [tool.name, tool]));
  return { declared, deferred };
}

function loadedBy(message: AgentMessage): string[] {
  if (message.role !== 'toolResult' || message.toolName !== TOOL_SEARCH || message.isError) {
    return [];
  }
  const details: unknown = message.details;
  const loaded: unknown = typeof details === 'object' && details !== null ? Reflect.get(details, 'loaded') : undefined;
  return Array.isArray(loaded) ? loaded.filter((name): name is string => typeof name === 'string') : [];
}

function calledBy(message: AgentMessage): string[] {
  return message.role === 'assistant'
    ? message.content.flatMap((part) => (part.type === 'toolCall' ? [part.name] : [])) : [];
}

function declaration(names: readonly string[], deferred: ReadonlyMap<string, AgentTool>, declared: Set<string>,
  timestamp: number): SystemMessage | null {
  const tools = names.filter((name) => !declared.has(name)).flatMap((name) => {
    const tool = deferred.get(name);
    declared.add(name);
    return tool === undefined ? [] : [toToolDeclaration(tool)];
  });
  return tools.length === 0 ? null : { role: 'system', content: '', toolsAdded: tools, timestamp };
}

/** 历史里找到过、调用过的按需工具：在那一步插一条声明（调用的在调用之前，找到的在结果之后）。 */
export function declareLoaded(messages: readonly AgentMessage[], deferred: ReadonlyMap<string, AgentTool>)
  : AgentMessage[] {
  if (deferred.size === 0) {
    return [...messages];
  }
  const declared = new Set<string>();
  const out: AgentMessage[] = [];
  for (const message of messages) {
    const before = declaration(calledBy(message), deferred, declared, message.timestamp);
    if (before !== null) {
      out.push(before);
    }
    out.push(message);
    const after = declaration(loadedBy(message), deferred, declared, message.timestamp);
    if (after !== null) {
      out.push(after);
    }
  }
  return out;
}

export interface CatalogEntry {
  name: string;
  label: string;
  description: string;
}

/** 说明的头一句（找到的列表里只给这么多，全文在声明里）。 */
function firstSentence(text: string): string {
  const head = text.split(/(?<=[。！？.!?])\s*/u)[0] ?? text;
  return Array.from(head).slice(0, 80).join('');
}

function terms(query: string): string[] {
  const words = query.toLowerCase().split(/[\s,，、;；。/|]+/u).filter((word) => word !== '');
  const grams = words.flatMap((word) => {
    const chars = Array.from(word);
    return /\p{Script=Han}/u.test(word) && chars.length > 2
      ? chars.slice(0, -1).map((char, index) => char + chars[index + 1]) : [];
  });
  return [...new Set([...words, ...grams])];
}

/** 按名字和说明打分：名字对上的最前，其次名字里有、说明里有。 */
export function searchCatalog(catalog: readonly CatalogEntry[], query: string, limit = SEARCH_LIMIT): CatalogEntry[] {
  const wanted = terms(query);
  const scored = catalog.map((entry) => {
    const name = entry.name.toLowerCase();
    const text = `${entry.label} ${entry.description}`.toLowerCase();
    const score = wanted.reduce((sum, term) => sum + (name === term ? 100 : 0) + (name.includes(term) ? 10 : 0)
      + (text.includes(term) ? 3 : 0), 0);
    return { entry, score };
  });
  return scored.filter((item) => item.score > 0).sort((left, right) => right.score - left.score)
    .slice(0, limit).map((item) => item.entry);
}

const SearchParameters = Type.Object({
  query: Type.String({ minLength: 1, maxLength: 200,
    description: '要做的事或工具名，空格隔开（如「笔记 搜索」「note_search note_read」）' }),
}, { additionalProperties: false });

/** 这条线按需能用的工具（没声明的那些），由 kernel 按线给。 */
export type Catalog = (scope: LineScope) => CatalogEntry[];

export function toolSearchTool(catalog: Catalog, enabled: () => boolean): KernelTool {
  return {
    name: TOOL_SEARCH,
    say: (args) => `找工具：${String(args['query'] ?? '')}`,
    hardLine: () => null,
    enabled,
    create: (scope) => ({
      name: TOOL_SEARCH,
      label: '找工具',
      description: '系统提示里列了名字、但还不在工具列表里的工具，先用这个按名字或要做的事找出来：找到的从下一步起'
        + '就能直接调用。',
      parameters: SearchParameters,
      replay: 'safe',
      async execute(_id, raw) {
        const { query } = checkedArgs(SearchParameters, raw, TOOL_SEARCH);
        const found = searchCatalog(catalog(scope), query);
        if (found.length === 0) {
          return { content: [{ type: 'text', text: `没找到和「${query}」有关的工具：换个说法，或者看系统提示里`
            + '「本轮实际可用工具」那一行的名字。' }], details: { loaded: [] } };
        }
        const lines = found.map((entry) => `- ${entry.name}（${entry.label}）：${firstSentence(entry.description)}`);
        return { content: [{ type: 'text', text: ['找到了，下一步就能直接调用：', ...lines].join('\n') }],
          details: { loaded: found.map((entry) => entry.name) } };
      },
    }),
  };
}
