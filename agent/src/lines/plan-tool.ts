// line_plan（11-16 能力总表「线自己的步骤清单」）：一件要做好几步的事，先列出步骤，做一步勾一步；他在工作详情最上面
// 看到清单，主线里那件任务的一行写「第 3 步，共 5 步：……」。每次给整份（改字、加步、勾掉都一样），重放结果相同。

import type { AgentTool } from '@earendil-works/pi-agent-core';
import { Type } from 'typebox';
import { LINE_PLAN_STEP_MAX_CHARS, LINE_PLAN_STEPS_MAX } from '../../shared/api/lines.ts';
import type { StateService } from '../state/index.ts';
import { checkedArgs } from './tool-args.ts';
import type { KernelTool, LineScope } from './types.ts';

export const PLAN_TOOL = 'line_plan';

const PlanParameters = Type.Object({
  steps: Type.Array(Type.Object({
    text: Type.String({ minLength: 1, maxLength: LINE_PLAN_STEP_MAX_CHARS,
      description: '一步做什么，一句他看得懂的话；有数的写上（「打招呼 · 37 / 200」）' }),
    status: Type.Union([Type.Literal('todo'), Type.Literal('running'), Type.Literal('done'), Type.Literal('skipped')]),
  }, { additionalProperties: false }), { maxItems: LINE_PLAN_STEPS_MAX,
    description: '整份清单，按顺序；正在做的那一步是 running（最多一步）。给空数组就是清掉。' }),
}, { additionalProperties: false });

type PlanState = Pick<StateService, 'linePlans'>;

function createPlan(state: PlanState, changed: (lineId: string) => void, scope: LineScope)
  : AgentTool<typeof PlanParameters> {
  return {
    name: PLAN_TOOL,
    label: '列步骤',
    description: '要做三步以上的事，先列步骤（status 都是 todo，第一步 running），做完一步再调一次把它改成 done、'
      + '下一步改成 running。每次给整份清单。三步以内、一下就做完的不用列。',
    parameters: PlanParameters,
    replay: 'safe',
    async execute(_toolCallId, raw) {
      const args = checkedArgs(PlanParameters, raw, PLAN_TOOL);
      if (args.steps.filter((step) => step.status === 'running').length > 1) {
        throw new Error('同时只能有一步在做（running）：别的改成 todo 或 done。');
      }
      state.linePlans.set(scope.lineId, args.steps.length === 0 ? null : args.steps);
      changed(scope.lineId);
      const done = args.steps.filter((step) => step.status === 'done' || step.status === 'skipped').length;
      return { content: [{ type: 'text', text: args.steps.length === 0 ? '清单清掉了。'
        : `记下了：${done} / ${args.steps.length} 步。` }], details: {} };
    },
  };
}

export function planTool(state: PlanState, changed: (lineId: string) => void): KernelTool {
  return {
    name: PLAN_TOOL,
    say: (args) => {
      const steps = Array.isArray(args['steps']) ? args['steps'] as { status?: unknown }[] : [];
      const done = steps.filter((step) => step.status === 'done' || step.status === 'skipped').length;
      return steps.length === 0 ? '清掉步骤清单' : `步骤 ${done} / ${steps.length}`;
    },
    hardLine: () => null,
    create: (scope) => createPlan(state, changed, scope),
  };
}
