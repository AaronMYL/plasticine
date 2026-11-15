// 第三级：记住一句（旧的 remember_conversation 的同一条记法：planCuration 校验、applyPlan 落库）。来源换成线里
// 他自己说的那一条（直接输入或问题卡的真实回答）：给了 quote 就找最近含这句话的原话，没给就是最近一条。锚点 ref 写成
// line:<线>:<seq>，链回原话。来源只能是他说的话，推测和 Plasticine 自己的话不能当来源（模型只能写 inferred 让他确认）。

import { Type } from 'typebox';
import type { AgentTool } from '@earendil-works/pi-agent-core';
import { RememberParameters, rememberWithSources, type CurationSource, type CurationState } from '../memory/index.ts';
import { plainText, type StateService } from '../state/index.ts';
import { checkedArgs } from './tool-args.ts';
import type { KernelTool, LineScope } from './types.ts';

// 往回找他说过的话最多看这么多条用户消息：再早的话该在压缩摘要里，记一行用不着翻那么远。
const RECENT_USER_MESSAGES = 30;

// 参数在函数里拼、不放在文件顶层：memory/ 和 lines/ 互相引用，顶层就读对方的常量会赶上对方还没初始化。
function lineParameters() {
  const { messageIds: _messageIds, ...rememberFields } = RememberParameters.properties;
  return Type.Object({
    ...rememberFields,
    quote: Type.Optional(Type.String({ minLength: 1, maxLength: 500,
      description: 'His exact words this line comes from (a phrase from one of his recent messages in this line)' })),
  }, { additionalProperties: false });
}
type RememberLineParameters = ReturnType<typeof lineParameters>;

export type RememberState = CurationState & Pick<StateService, 'lineMessages'>;

function squash(text: string): string {
  return text.replace(/\s+/g, '');
}

/** 他说过的那一条（最近的在前找）。 */
function sourceSeq(state: RememberState, lineId: string, quote: string | undefined): number | null {
  const rows = state.lineMessages.page(lineId, null, RECENT_USER_MESSAGES * 4).rows
    .filter((row) => row.meta?.origin?.kind === 'user')
    .slice(-RECENT_USER_MESSAGES).reverse();
  for (const row of rows) {
    const said = squash(row.meta?.origin?.userText ?? plainText(row.message));
    if (said !== '' && (quote === undefined || said.includes(squash(quote)))) {
      return row.seq;
    }
  }
  return null;
}

function createRemember(state: RememberState, scope: LineScope): AgentTool<RememberLineParameters> {
  const parameters = lineParameters();
  return {
    name: 'remember',
    label: '记住一句',
    description: '把他在这条线里明确说过、以后还用得上的事（偏好、决定、纠正、人物、长期项目）当场记成主题文档里的一行，'
      + '链回他的原话（quote 写他说的那句里的一段）。先分层：关于他这个人的进「关于你」（docId 不写）或人物、项目、话题'
      + '文档（docId 照「记忆文档」目录写）；他允许、禁止、暂停你做某类事，或你答应他以后要做的事，进 memdoc-grants，'
      + 'section 写 allow（可以直接做）、ask（先问他）、hold（先停着）、promise（你答应的）；他说别主动提什么、什么时候'
      + '别打扰、通知写成什么样，进 memdoc-proactive，section 写 never、when、style；他说的具体做事方法进做事经验里'
      + '那个工具、网站或流程的一篇（没有就 newDoc，kind 写 how），section 写 do 或 avoid。没有合适的人物或话题文档就给'
      + ' newDoc。同一件事变了用 replacesLineId 改那一行。你的推测、分不清放哪层的标 inferred 并写 why，只进'
      + '「拿不准的」等他确认。查来的资料和你自己的建议不记；你自己试出来的做法用 note_experience。',
    parameters,
    async execute(toolCallId, raw) {
      const { quote, ...args } = checkedArgs(parameters, raw, 'remember');
      const seq = sourceSeq(state, scope.lineId, quote);
      if (seq === null) {
        throw new Error(quote === undefined ? '这条线里还没有他说的话，没有可以链回的原话。'
          : '最近他说的话里找不到这句：quote 要是他原话里的一段。');
      }
      const ref = `line:${scope.lineId}:${seq}`;
      const sources = new Map<string, CurationSource>([[ref, { anchors: [{ kind: 'message', ref }], stated: true }]]);
      const text = rememberWithSources(state, { ...args, messageIds: [ref] }, sources,
        { actionId: `line:${scope.lineId}:${toolCallId}`, runId: `line:${scope.lineId}` });
      return { content: [{ type: 'text', text }], details: {} };
    },
  };
}

export function rememberTool(state: RememberState): KernelTool {
  return {
    name: 'remember',
    say: (args) => (typeof args['text'] === 'string' ? `记住：${args['text']}` : '记住一句'),
    hardLine: () => null,
    create: (scope) => createRemember(state, scope),
  };
}
