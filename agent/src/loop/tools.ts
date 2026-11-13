// 预测闭环（11-13 Aaron 定「被改或被拒一次就退回先问」）：他说「这类还是先问我」，或者放了手直接做的结果他不满意，
// 模型调 loop_take_back 收回这一类。收回只记时间和原因（不删），之后从头重新数连续同意。

import { Type } from 'typebox';
import type { AgentTool } from '@earendil-works/pi-agent-core';
import { checkedArgs } from '../lines/tool-args.ts';
import type { KernelTool } from '../lines/types.ts';
import type { StateService } from '../state/index.ts';

export const TAKE_BACK_TOOL = 'loop_take_back';

const TakeBackParameters = Type.Object({
  topic: Type.String({ minLength: 1, maxLength: 16, description: '放过手的那一类的叫法，照「他放过手的几类事」里写' }),
  reason: Type.String({ minLength: 1, maxLength: 200, description: '他的原话，或他为什么不满意（一句）' }),
}, { additionalProperties: false });

function createTakeBack(state: Pick<StateService, 'loop'>): AgentTool<typeof TakeBackParameters> {
  return {
    name: TAKE_BACK_TOOL,
    label: '收回放手',
    description: '他说某一类「还是先问我」，或你按放手直接做的事他改了、不满意时调：收回这一类，之后推出来的照常出卡问他。',
    parameters: TakeBackParameters,
    async execute(_toolCallId, raw) {
      const args = checkedArgs(TakeBackParameters, raw, TAKE_BACK_TOOL);
      const revoked = state.loop.grants.revoke(args.topic, args.reason);
      const text = revoked ? `收回了：「${args.topic}」这类以后照常先问他。`
        : `「${args.topic}」这类本来就没放手，照常先问他。`;
      return { content: [{ type: 'text', text }], details: { revoked } };
    },
  };
}

export function loopTools(state: Partial<Pick<StateService, 'loop'>>): KernelTool[] {
  const loop = state.loop;
  if (loop === undefined) {
    return [];
  }
  return [{ name: TAKE_BACK_TOOL, say: (args) => `收回放手：${String(args['topic'] ?? '')}`, hardLine: () => null,
    create: () => createTakeBack({ loop }) }];
}
