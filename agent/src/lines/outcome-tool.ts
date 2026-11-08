// 后台线说清这件事做成没有（走查 11-07：线跑完了、事没做成也打了勾）。「跑完」看这一轮怎么停的，「做成」只由线自己在
// 这里明说，不从它最后那段话里按关键词猜；没调过的线（旧记录）照旧按做完。没做成要写一句给他看的原因。
// 记在线上（unmet_reason、verdict_seq）：之后这条线又收到新的输入，上一轮说的就不算数（verdict.ts）。
// 第 17 条（走查 11-07）：同时交一段结论（conclusion）给发起它的线——说给人听的话；技术交接留在这条线自己里。

import { Type } from 'typebox';
import type { AgentTool } from '@earendil-works/pi-agent-core';
import type { StateService } from '../state/index.ts';
import { checkedArgs } from './tool-args.ts';
import type { KernelTool, LineScope } from './types.ts';

export const OUTCOME_TOOL = 'line_outcome';
// 首页和卡片上一行写得下的长度。
const REASON_MAX_CHARS = 80;
// 结论几句话：主线里一段读得完。
export const CONCLUSION_MAX_CHARS = 1_200;

const OutcomeParameters = Type.Object({
  done: Type.Boolean({ description: 'true only if the thing he asked for actually happened' }),
  reason: Type.Optional(Type.String({ minLength: 1, maxLength: REASON_MAX_CHARS,
    description: 'Required when done is false: one short Chinese sentence, why it did not happen' })),
  conclusion: Type.Optional(Type.String({ minLength: 1, maxLength: CONCLUSION_MAX_CHARS,
    description: 'What the caller gets back: a few plain Chinese sentences for a person (the finding, key evidence '
      + 'with source links, what is still missing). No commit hashes, server paths, logs or instructions to the '
      + 'caller; those stay in your final message on this line.' })),
}, { additionalProperties: false });

export type OutcomeState = Pick<StateService, 'lines' | 'lineMessages'>;

function createOutcome(state: OutcomeState, scope: LineScope): AgentTool<typeof OutcomeParameters> {
  return {
    name: OUTCOME_TOOL,
    label: '说做成没有',
    description: '这条后台线结束前调一次：要做的事真的做成了写 done: true；没做成（建不了、被拒、缺东西、只做了一半）'
      + '写 done: false 和一句原因（给他看的大白话）。然后照常写最后那段话。',
    parameters: OutcomeParameters,
    async execute(_toolCallId, raw) {
      const args = checkedArgs(OutcomeParameters, raw, OUTCOME_TOOL);
      const reason = args.reason?.trim() ?? '';
      if (!args.done && reason === '') {
        throw new Error('没做成要写一句原因（reason），这次没有记下。');
      }
      const seq = state.lineMessages.last(scope.lineId)?.seq ?? 0;
      const conclusion = args.conclusion?.trim() ?? '';
      state.lines.update(scope.lineId, { unmetReason: args.done ? null : reason, verdictSeq: seq,
        conclusion: conclusion === '' ? null : conclusion });
      return { content: [{ type: 'text', text: args.done ? '记下了：做成了。' : `记下了：没做成（${reason}）。` }],
        details: {} };
    },
  };
}

export function outcomeTool(state: OutcomeState): KernelTool {
  return {
    name: OUTCOME_TOOL,
    say: (args) => (args['done'] === false && typeof args['reason'] === 'string' && args['reason'].trim() !== ''
      ? `没做成：${args['reason'].trim()}` : '做成了'),
    hardLine: () => null,
    lineKinds: ['background'],
    create: (scope) => createOutcome(state, scope),
  };
}
