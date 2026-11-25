import type { AgentTool } from '@earendil-works/pi-agent-core';
import { Type } from 'typebox';
import { HANDOFF_SHOW_CALL_SUFFIX } from '../devices/index.ts';
import { awaitAnswer, answerSentence, QUESTION_PURPOSE, type AskToolHost } from './ask-tools.ts';
import { checkedArgs } from './tool-args.ts';
import type { KernelTool, LineScope } from './types.ts';

const WHAT_MAX_CHARS = 33;

const HandoffParameters = Type.Object({
  nodeId: Type.String({ minLength: 1 }),
  tabId: Type.String({ minLength: 1, maxLength: 100 }),
  what: Type.String({ minLength: 2, maxLength: WHAT_MAX_CHARS, description: '要他做的那一步，如「扫码登录公众号后台」' }),
  detail: Type.Optional(Type.String({ maxLength: 1_000, description: '他做的时候要知道的（在哪、做到哪算完）' })),
}, { additionalProperties: false });

function createHandoff(host: AskToolHost, deviceAction: KernelTool, scope: LineScope)
  : AgentTool<typeof HandoffParameters> {
  return {
    name: 'tab_handoff',
    label: '请你接手一步',
    description: '只能他本人做的一步（登录、扫码、验证码、人脸、短信码）：把 Mac 上这个网页标签切到他眼前，出一张'
      + '「这一步要你来」卡，等他做完点「好了」再接着做。不替他填密码、验证码。',
    parameters: HandoffParameters,
    replay: 'safe',
    executionMode: 'sequential',
    async execute(toolCallId, raw, signal) {
      const params = checkedArgs(HandoffParameters, raw, 'tab_handoff');
      const actionId = `line-ask:${scope.lineId}:${toolCallId}`;
      let ask = host.state.asks.byActionId(actionId);
      if (ask === undefined) {
        await deviceAction.create(scope).execute(`${toolCallId}${HANDOFF_SHOW_CALL_SUFFIX}`, { nodeId: params.nodeId,
          purpose: `请他接手：${params.what}`, action: { kind: 'tab_show', tabId: params.tabId } }, signal);
        ask = host.desk.commit((changes) => host.desk.raise(changes, {
          kind: 'act',
          purpose: QUESTION_PURPOSE,
          question: `这一步要你来：${params.what}`,
          detail: params.detail ?? '网页已经切到前面。做完点「好了」，Plasticine 接着做。',
          options: [{ id: 'done', label: '好了', recommended: true, description: null },
            { id: 'cannot', label: '做不了', description: null }],
          actionId,
          context: { lineId: scope.lineId, toolCallId },
          basis: 'hard_line',
          channel: 'popup',
        }));
      }
      const answered = await awaitAnswer(host, scope.lineId, ask, signal);
      return { content: [{ type: 'text', text: answered.answer?.optionId === 'done'
        ? '他做完了这一步：重新 tab_perceive 看一眼页面再接着做。' : answerSentence(answered) }],
      details: { askId: answered.id } };
    },
  };
}

export function tabHandoffTool(host: AskToolHost, deviceAction: KernelTool): KernelTool {
  return {
    name: 'tab_handoff',
    say: (args) => `请你接手：${String(args['what'] ?? '')}`,
    hardLine: () => null,
    create: (scope) => createHandoff(host, deviceAction, scope),
  };
}
