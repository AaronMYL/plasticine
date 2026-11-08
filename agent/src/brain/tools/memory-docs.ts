// 记忆文档的读工具（docs/specs/memory-docs.md 第 4 节）：上下文里只有目录和「关于你」，其余文档的正文按需读。
// 只读：写由后台整理、file_to_project 的决定和用户在记忆页做。第 16 条（11-06）：目录里写的是名字，按名字读；
// 搜索默认只搜现行，archive 时连归档一起搜。

import { Type } from 'typebox';
import type { StateService } from '../../state/index.ts';
import { findDoc, memoryDocView, searchMemory, SEARCH_DEFAULT_LIMIT } from '../memory-docs-context.ts';
import { defineTool, type Tool } from './registry.ts';

const READ = { effect: 'read', permission: 'auto', replay: 'safe', parallel: true, timeoutMs: 2000 } as const;
const ROLES: ('conversation' | 'worker' | 'diagnosis' | 'verifier')[] = ['conversation', 'worker', 'diagnosis',
  'verifier'];
const SEARCH_MAX_LIMIT = 50;

export function createMemoryDocTools(state: Pick<StateService, 'memoryDocs' | 'projects'>): Tool[] {
  return [
    defineTool({
      ...READ, roles: ROLES, name: 'read_memory_doc', label: '读一份记忆文档',
      description: '按名字读一篇记忆文档（name 照上下文目录里的名字写）：一句话说明、决定段和其余在用的行，'
        + '每行带它链回的原话锚点。回答涉及某个人、项目、话题或技能时先读，照文档答，不让用户重讲。'
        + 'includeRetired 为 true 时连归档（被取代的旧说法、过时的事实）一起看。',
      parameters: Type.Object({ name: Type.Optional(Type.String({ minLength: 1 })),
        docId: Type.Optional(Type.String({ minLength: 1 })), includeRetired: Type.Optional(Type.Boolean()) },
      { additionalProperties: false }),
      async execute(args) {
        const key = args.name ?? args.docId;
        const doc = key === undefined ? undefined : findDoc(state, key);
        if (doc === undefined) {
          throw new Error('没有这篇记忆；名字照上下文里目录写的填，或者先用 search_memory 找。');
        }
        return JSON.stringify(memoryDocView(state, doc, args.includeRetired === true));
      },
    }),
    defineTool({
      ...READ, roles: ROLES, name: 'search_memory', label: '搜记忆',
      description: '跨全部记忆文档按词搜行（中文按相邻两字比），最像的在前；不知道在哪篇里时用。默认只搜现行；'
        + '他问以前怎么定的、要忘掉的事可能在旧说法里时，archive 设 true 连归档一起搜（结果里 archived 为 true）。',
      parameters: Type.Object({ query: Type.String({ minLength: 1, maxLength: 500 }),
        limit: Type.Optional(Type.Integer({ minimum: 1, maximum: SEARCH_MAX_LIMIT })),
        archive: Type.Optional(Type.Boolean()) },
      { additionalProperties: false }),
      async execute(args) {
        const hits = searchMemory(state, args.query, args.limit ?? SEARCH_DEFAULT_LIMIT, args.archive === true);
        return JSON.stringify(hits.map((hit) => ({ doc: hit.docTitle, lineId: hit.line.id,
          section: hit.line.section, text: hit.line.text, previous: hit.line.previous,
          archived: hit.line.archivedAt !== null })));
      },
    }),
  ];
}
