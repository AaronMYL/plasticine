import { Type } from 'typebox';
import type { AgentTool } from '@earendil-works/pi-agent-core';
import { SUBMIT_KIND_LABELS } from '../../shared/api/index.ts';
import { PAGE_SUBMIT_CONTEXT_KEY, type PageSubmitContext, type SubmitHold } from '../devices/index.ts';
import { answerSentence, awaitAnswer, QUESTION_PURPOSE, type AskToolHost } from './ask-tools.ts';
import { checkedArgs } from './tool-args.ts';
import type { KernelTool, LineScope } from './types.ts';

const QUESTION_MAX_CHARS = 40;
const DETAIL_MAX_CHARS = 1_000;
const OptionId = Type.String({ pattern: '^[a-z0-9][a-z0-9_-]{0,31}$' });

const PageSubmitAskParameters = Type.Object({
  nodeId: Type.String({ minLength: 1 }),
  tabId: Type.String({ minLength: 1, maxLength: 100 }),
  version: Type.String({ minLength: 1, maxLength: 40,
    description: 'The page version of the tab_act that came back submit_needs_you' }),
  question: Type.String({ minLength: 1, maxLength: QUESTION_MAX_CHARS,
    description: 'One Chinese sentence asking whether to submit, e.g. 要提交报名并付 ¥180 吗？' }),
  detail: Type.String({ maxLength: DETAIL_MAX_CHARS,
    description: 'What else he should know before deciding (fields still empty, what was filled); may be empty' }),
  options: Type.Array(Type.Object({
    id: OptionId,
    label: Type.String({ minLength: 1, maxLength: 30 }),
    recommended: Type.Optional(Type.Boolean()),
  }, { additionalProperties: false }), { minItems: 2, maxItems: 4,
    description: 'Two or three options; exactly one of them is the submit option; mark the one you recommend' }),
  submitOption: OptionId,
}, { additionalProperties: false });

export interface SubmitHoldPort {
  submitHoldForRun(runId: string, nodeId: string, tabId: string): SubmitHold | null;
}

function createPageSubmitAsk(host: AskToolHost, devices: SubmitHoldPort, scope: LineScope)
  : AgentTool<typeof PageSubmitAskParameters> {
  return {
    name: 'page_submit_ask',
    label: '提交前问你',
    description: 'device_action 的 tab_act 回了 submit_needs_you（设备没点付款、删除、改设置这类提交）以后用：出一张卡问他要不要提交，等他选。'
      + '卡上照设备回执写清提交会怎样。只有他选了提交，才把结果里的卡片 id 作为 submitAsk，原样再做一次那个 tab_act。',
    parameters: PageSubmitAskParameters,
    replay: 'safe',
    async execute(toolCallId, raw, signal) {
      const args = checkedArgs(PageSubmitAskParameters, raw, 'page_submit_ask');
      if (args.options.filter((option) => option.id === args.submitOption).length !== 1) {
        throw new Error('选项里要有且只有一项是提交（submitOption 对上一个选项的 id）。');
      }
      const runId = `line:${scope.lineId}`;
      const hold = devices.submitHoldForRun(runId, args.nodeId, args.tabId);
      if (hold === null) {
        throw new Error('这条线在这个标签上还没有被设备拦下的提交：先用 tab_act 点那个提交，设备拦下来后再问。');
      }
      if (hold.kind === 'publish' || hold.kind === 'submit') {
        throw new Error('拦下的是发出去或表单提交：用 page_send 按承诺和授权发，不用一条一问。');
      }
      if (hold.version !== args.version) {
        throw new Error(`最近被拦下的那一下在页面版本 ${hold.version} 上，不是 ${args.version}：照那一下问，或重新点一次。`);
      }
      const pageSubmit: PageSubmitContext = { nodeId: args.nodeId, tabId: hold.tabId, version: hold.version, n: hold.n,
        op: hold.op,
        kind: hold.kind, label: hold.label, submitOption: args.submitOption };
      const consequence = `提交后会：${SUBMIT_KIND_LABELS[hold.kind]}（「${hold.label}」）。`;
      const ask = host.desk.commit((changes) => host.desk.raise(changes, {
        kind: 'decide',
        purpose: QUESTION_PURPOSE,
        question: args.question,
        detail: args.detail.trim() === '' ? consequence : `${consequence}\n${args.detail.trim()}`,
        options: args.options.map((option) => ({ id: option.id, label: option.label,
          ...(option.recommended === undefined ? {} : { recommended: option.recommended }),
          description: option.id === args.submitOption ? consequence : null })),
        actionId: `page-submit:${hold.actionId}`,
        runId,
        context: { lineId: scope.lineId, toolCallId, [PAGE_SUBMIT_CONTEXT_KEY]: pageSubmit },
        basis: 'hard_line',
        channel: scope.kind === 'background' ? 'interrupt' : 'popup',
      }));
      const answered = await awaitAnswer(host, scope.lineId, ask, signal);
      const chose = answered.answer?.optionId === args.submitOption;
      const next = chose ? `现在带 submitAsk=${answered.id} 原样点一次（同一个标签、同一版页面、同一个元素）。`
        : '照他选的做，不提交。';
      return { content: [{ type: 'text', text: `${answerSentence(answered)}。${next}` }],
        details: { askId: answered.id } };
    },
  };
}

export function pageSubmitAskTool(host: AskToolHost, devices: SubmitHoldPort): KernelTool {
  return {
    name: 'page_submit_ask',
    say: (args) => (typeof args['question'] === 'string' ? `问你：${args['question']}` : '提交前问你'),
    hardLine: () => null,
    create: (scope) => createPageSubmitAsk(host, devices, scope),
  };
}
