import type { AgentMessage, AgentTool } from '@earendil-works/pi-agent-core';
import { toToolDeclaration, type SystemMessage } from '@earendil-works/pi-ai';
import { Type } from 'typebox';
import { checkedArgs } from './tool-args.ts';
import type { LineKind } from '../../shared/api/index.ts';
import type { KernelTool, LineScope } from './types.ts';

export const TOOL_SEARCH = 'tool_search';
export const SEARCH_LIMIT = 6;

const COMMON = ['read_line', 'tell_line', 'read_result', 'read_memory_doc', 'read_project', 'list_projects',
  'conversation_search', 'skill_read', 'ask_user'];
const COORDINATE = ['list_lines', 'start_line', 'mate_handoff', 'remember'];
const WORK = ['server_command', 'server_command_read', 'device_nodes', 'device_action', 'cloud_browser_open',
  'cloud_browser_observe', 'cloud_browser_read', 'space_read', 'space_write', 'line_plan', 'line_outcome'];

export type DirectTools = Readonly<Record<LineKind, readonly string[]>>;

export const DIRECT_TOOLS: DirectTools = {
  main: [...COMMON, ...COORDINATE],
  side: [...COMMON, ...COORDINATE],
  background: [...COMMON, ...WORK],
};

export interface Loadout {
  declared: AgentTool[];
  deferred: ReadonlyMap<string, AgentTool>;
}

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
