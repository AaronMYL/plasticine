// 忘掉（《优化清单》第 16 条，11-06 定）：他说「忘掉 X」时，现行和归档里的那几行都删，今天记录里同一件事也删；11-07 他定
// 真的从库里抹掉（brain 的 forgetMemory）。撤不回，属于硬线里的「删除」：执行前出卡确认一次（hard-line.ts），他同意了才删。
// 行先用 search_memory（archive）找到。

import { Type } from 'typebox';
import type { AgentTool } from '@earendil-works/pi-agent-core';
import { forgetMemory } from '../brain/index.ts';
import type { StateService } from '../state/index.ts';
import { clip } from './messages.ts';
import { checkedArgs } from './tool-args.ts';
import type { KernelTool, LineScope } from './types.ts';

// 一次最多忘掉这么多行：多了说明是在清一大片，该让他一件一件说清楚。
const MAX_LINES = 20;
const WHAT_CHARS = 30;

const ForgetParameters = Type.Object({
  lineIds: Type.Array(Type.String({ minLength: 1 }), { minItems: 1, maxItems: MAX_LINES,
    description: 'Line ids to forget, from search_memory with archive: true (current and archived lines alike)' }),
  what: Type.String({ minLength: 1, maxLength: 200, description: 'What he asked to forget, in his words' }),
}, { additionalProperties: false });

export type ForgetState = Pick<StateService, 'memoryDocs' | 'memoryJournal' | 'memoryDreams' | 'memoryCuration'
  | 'erasing'>;

function what(args: Record<string, unknown>): string {
  return typeof args['what'] === 'string' ? clip(args['what'], WHAT_CHARS) : '这几行记忆';
}

function createForget(state: ForgetState, scope: LineScope): AgentTool<typeof ForgetParameters> {
  return {
    name: 'forget',
    label: '忘掉',
    description: '他明说要忘掉某件事时用：把记忆里讲这件事的行（现行和归档里的都算）删掉，今天的记录里同一件事也删。'
      + '先用 search_memory（archive 设 true）找到所有相关的行，一次传齐。撤不回，执行前会出卡让他确认。'
      + '他只是说某件事不再成立、或者改口了，不用这个工具。',
    parameters: ForgetParameters,
    async execute(toolCallId, raw) {
      const args = checkedArgs(ForgetParameters, raw, 'forget');
      const ids = [...new Set(args.lineIds)];
      const missing = ids.filter((id) => {
        const line = state.memoryDocs.lines.get(id);
        return line === undefined || line.deletedAt !== null;
      });
      if (missing.length > 0) {
        throw new Error(`找不到这几行（或已经忘掉了）：${missing.join('、')}。先用 search_memory 带 archive 重新找。`);
      }
      const result = forgetMemory(state, ids, { actor: 'brain', ref: `line:${scope.lineId}:${toolCallId}` });
      const text = `忘掉了 ${result.lines.length} 行，今天的记录里删了 ${result.journal} 条。`;
      return { content: [{ type: 'text', text }], details: {} };
    },
  };
}

export function forgetTool(state: ForgetState): KernelTool {
  return {
    name: 'forget',
    say: (args) => `忘掉${what(args)}`,
    hardLine: () => 'irreversible',
    consequence: (args) => {
      const count = Array.isArray(args['lineIds']) ? args['lineIds'].length : 0;
      return `记忆里讲这件事的 ${count} 行（连同归档里的旧说法）会从库里抹掉，撤不回。`;
    },
    approveLabel: () => '忘掉',
    create: (scope) => createForget(state, scope),
  };
}
