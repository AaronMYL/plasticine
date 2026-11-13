// ask_user：线上问他一件事（「做还是问」那条线：推出来的出确认卡、几种可能给选项、资料里没有才问）。出一张要你定卡，
// 线进 waiting，他答了答案就是这次工具的结果，线接着跑。卡按「这条线 + 这次调用」的动作标识出，同一次调用重跑
// （重启后接着跑）认回同一张卡：答过了直接拿答案，还开着就接着等，不会出第二张。

import { Type } from 'typebox';
import type { AgentTool } from '@earendil-works/pi-agent-core';
import type { ToolResultMessage } from '@earendil-works/pi-ai';
import { ASK_BASES, basisShapeProblem, BASIS_PARAMETER_DESCRIPTION } from '../../shared/act-or-ask.ts';
import type { LineInputOrigin } from '../../shared/api/lines.ts';
import type { Ask } from '../../shared/state.ts';
import type { AskDesk, AskResolver } from '../attention/index.ts';
import type { StateService } from '../state/index.ts';
import { autoChoice, raiseOffer, recordAsk, settleAsk } from '../loop/autonomy.ts';
import { withdrawAsk } from './hard-line.ts';
import { checkedArgs } from './tool-args.ts';
import type { KernelTool, LineScope } from './types.ts';
import type { AnswerWaits } from './waits.ts';

export const QUESTION_PURPOSE = 'line_question';
// 《UI 方案》第 6 节：卡的一句 ≤ 40 字；选项最多 6 个。
const QUESTION_MAX_CHARS = 40;

const AskUserParameters = Type.Object({
  kind: Type.Enum(['decide', 'confirm', 'act'], { description: 'decide 要你定 · confirm 要你确认 · act 要你动手' }),
  question: Type.String({ minLength: 1, maxLength: QUESTION_MAX_CHARS, description: 'One Chinese sentence' }),
  detail: Type.Optional(Type.String({ maxLength: 4_000, description: 'What he needs to know to decide' })),
  options: Type.Array(Type.Object({
    id: Type.String({ pattern: '^[a-z0-9][a-z0-9_-]{0,31}$' }),
    label: Type.String({ minLength: 1, maxLength: 30 }),
    recommended: Type.Optional(Type.Boolean()),
    description: Type.Optional(Type.String({ maxLength: 200 })),
  }, { additionalProperties: false }), { maxItems: 6,
    description: 'Choices, recommended one first; empty when he should answer in words' }),
  basis: Type.Enum(ASK_BASES, { description: BASIS_PARAMETER_DESCRIPTION }),
  topic: Type.Optional(Type.String({ minLength: 1, maxLength: 16, description: '这类事的叫法，2–8 个字，同一类每次用'
    + '同一个词（如「排日程」「回邮件」「整理笔记」）。推出来的卡一定要写：他连续原样同意够多次，会问他这类能不能以后直接做' })),
}, { additionalProperties: false });

export interface AskToolHost {
  /** loop：预测闭环（11-13）；没有的地方（测试里的内核）不记、不放手。 */
  state: Pick<StateService, 'asks' | 'transaction'> & Partial<Pick<StateService, 'loop'>>;
  desk: AskDesk;
  waits: AnswerWaits;
  waiting(lineId: string, on: boolean): void;
  now(): Date;
  /** 关服务时中止的等待不撤卡：重启后接着等同一张卡。 */
  shuttingDown(): boolean;
}

/** 他的回答作为工具结果：选了什么、多写了什么。 */
export function answerSentence(ask: Ask): string {
  const answer = ask.answer;
  if (answer === null) {
    return '他还没有回答。';
  }
  if (answer.optionId === null) {
    return `他回答：${answer.label}`;
  }
  return answer.text === null || answer.text.trim() === '' ? `他选了：${answer.label}`
    : `他选了：${answer.label}（他补充：${answer.text.trim()}）`;
}

/** 工具结果的 role 不代表来源；只从这次问题卡的已认证作答恢复用户原文，不信任结果里自报的身份。 */
export function questionAnswerOrigin(state: Pick<StateService, 'asks'>, lineId: string,
  message: ToolResultMessage): LineInputOrigin | undefined {
  if (message.toolName !== 'ask_user' || message.isError || typeof message.details !== 'object'
    || message.details === null) {
    return undefined;
  }
  const askId: unknown = Reflect.get(message.details, 'askId');
  const ask = typeof askId === 'string' ? state.asks.get(askId) : undefined;
  if (ask?.purpose !== QUESTION_PURPOSE || ask.status !== 'answered' || ask.answer === null
    || ask.answeredAt === null || ask.answeredByDeviceId === null
    || ask.context?.['lineId'] !== lineId || ask.context?.['toolCallId'] !== message.toolCallId
    || ask.actionId !== `line-ask:${lineId}:${message.toolCallId}`) {
    return undefined;
  }
  const userText = ask.answer.text;
  if (userText === null || userText.trim() === '') {
    return undefined;
  }
  return { kind: 'user', ref: `ask:${ask.id}`, userText };
}

/** 等这张卡答完；暂缓时结束本次等待但保留卡，叫停时撤回。没有答案时不冒充用户作答。 */
export async function awaitAnswer(host: AskToolHost, lineId: string, ask: Ask,
  signal: AbortSignal | undefined): Promise<Ask> {
  if (ask.deferredAt !== null && ask.status === 'open') {
    throw new Error('用户暂缓了这个问题，尚未作答；不要执行依赖该答案的操作，可以继续处理其他消息。');
  }
  if (ask.status === 'open') {
    host.waiting(lineId, true);
    try {
      await host.waits.wait(ask.id, signal);
    } catch (error) {
      if (!host.shuttingDown()) {
        host.desk.commit((changes) => withdrawAsk(host.state, changes, ask.id, host.now().toISOString()));
      }
      throw error;
    } finally {
      host.waiting(lineId, false);
    }
  }
  const current = host.state.asks.get(ask.id) ?? ask;
  if (current.deferredAt !== null && current.status === 'open') {
    throw new Error('用户暂缓了这个问题，尚未作答；不要执行依赖该答案的操作，可以继续处理其他消息。');
  }
  if (current.status !== 'answered') {
    throw new Error('这张卡撤回了，没有等到他的回答。');
  }
  return current;
}

function createAskUser(host: AskToolHost, scope: LineScope): AgentTool<typeof AskUserParameters> {
  return {
    name: 'ask_user',
    label: '问你一件事',
    description: '按「做还是问」那条线问用户一件事：出一张要你定卡，等他答；他的回答就是这次的结果。'
      + '推出来的给且只给一个推荐项；几种可能至少两个选项；资料里没有可以不给选项让他写。'
      + '硬线的事（花钱、对外发出、撤不回、权限、要他本人做）不用这个：调对应的工具时系统会自己问他。',
    parameters: AskUserParameters,
    replay: 'safe',
    async execute(toolCallId, raw, signal) {
      const params = checkedArgs(AskUserParameters, raw, 'ask_user');
      const problem = basisShapeProblem(params.basis, params.options);
      if (problem !== null) {
        throw new Error(`卡没有出：${problem}`);
      }
      const loop = host.state.loop === undefined ? undefined : { loop: host.state.loop };
      const auto = loop === undefined ? null : autoChoice(loop, params.topic, params.basis, params.options);
      if (auto !== null) {
        return { content: [{ type: 'text', text: `这类事（「${params.topic ?? ''}」）他放过手，不出卡：按推荐的`
          + `「${auto.label}」直接做，做完在回答里告诉他一声。` }], details: { autoTopic: params.topic, optionId: auto.id } };
      }
      const ask = host.desk.commit((changes) => host.desk.raise(changes, {
        kind: params.kind,
        purpose: QUESTION_PURPOSE,
        question: params.question,
        detail: params.detail ?? null,
        options: params.options.map((option) => ({ id: option.id, label: option.label,
          ...(option.recommended === undefined ? {} : { recommended: option.recommended }),
          description: option.description ?? null })),
        actionId: `line-ask:${scope.lineId}:${toolCallId}`,
        context: { lineId: scope.lineId, toolCallId, ...(params.topic === undefined ? {} : { topic: params.topic }) },
        basis: params.basis,
        channel: scope.kind === 'background' ? 'interrupt' : 'popup',
      }));
      if (loop !== undefined) {
        recordAsk(loop, ask, params.topic);
      }
      const answered = await awaitAnswer(host, scope.lineId, ask, signal);
      const offer = loop === undefined ? null : settleAsk(loop, answered, params.topic);
      if (loop !== undefined && offer !== null) {
        host.desk.commit((changes) => raiseOffer(loop, host.desk, changes, offer));
      }
      return { content: [{ type: 'text', text: answerSentence(answered) }], details: { askId: answered.id } };
    },
  };
}

export function askUserTool(host: AskToolHost): KernelTool {
  return {
    name: 'ask_user',
    say: (args) => `问你：${String(args['question'] ?? '')}`,
    hardLine: () => null,
    create: (scope) => createAskUser(host, scope),
  };
}

/** 问他的卡答了：提交之后放开等它的那一处（没人等就由 kernel 接着跑这条线）。 */
export function questionResolver(answered: (ask: Ask) => void): AskResolver {
  return {
    deferred(changes, ask) {
      changes.afterCommit(() => answered(ask));
    },
    resolve(changes, ask) {
      changes.afterCommit(() => answered(ask));
    },
  };
}
