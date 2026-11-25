import { Type } from 'typebox';
import { submitHoldForRun } from './page-submits.ts';
import { tabTrace, UNVERIFIED_PASTE } from './page-trace.ts';
import type { ActionOutcome, ActionRequest } from './actions.ts';
import type { Refusal } from './limits.ts';
import { proveDeviceAction } from './proof.ts';
import { REFUSAL_LAYER_LABELS } from '../../shared/api/index.ts';
import type { StateService } from '../state/index.ts';
import { defineTool, ToolFailure, ToolUncertain, type Tool } from '../tools/index.ts';

export const PAGE_SEND_TOOL = 'page_send';
export const PAGE_SEND_KINDS: readonly string[] = ['publish', 'submit'];
export const PAGE_SEND_CATEGORY = 'message';
const LINE_RUN_PREFIX = 'line:';
const PAGE_SEND_TIMEOUT_MS = 2 * 60_000 + 1_000;

const Parameters = Type.Object({
  nodeId: Type.String({ minLength: 1 }),
  tabId: Type.String({ minLength: 1, maxLength: 100 }),
  version: Type.String({ minLength: 1, maxLength: 40,
    description: 'The page version of the tab_act that came back submit_needs_you' }),
  site: Type.String({ minLength: 3, maxLength: 200, description: 'Host of the page, e.g. www.zhipin.com' }),
  to: Type.String({ minLength: 1, maxLength: 80,
    description: 'Who receives it, as shown on the page, e.g. 杨崇义 · 探途 · 董事长' }),
  text: Type.String({ minLength: 1, maxLength: 4_000,
    description: 'Exactly what is being sent (what was filled into the box); for a button that sends a preset '
      + 'greeting, the button label' }),
}, { additionalProperties: false });

export function webChannel(site: string): string {
  return `web:${site.trim().toLowerCase().replace(/^www\./, '')}`;
}

function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, '');
  } catch (cause) {
    if (cause instanceof TypeError) {
      return null;
    }
    throw cause;
  }
}

export interface PageSendPort {
  perform(request: ActionRequest): Promise<ActionOutcome>;
  screen(request: Omit<ActionRequest, 'actionId'>): Refusal | null;
  submitRefusal(request: Omit<ActionRequest, 'actionId'>): Refusal | null;
}

type SendState = Pick<StateService, 'nodeActions' | 'outboundLog'>;

export function createPageSendTool(state: SendState, devices: PageSendPort): Tool {
  return defineTool({
    name: PAGE_SEND_TOOL,
    label: '网页里发出',
    description: '在网页上以他的名义发出准备好的东西（发送、发帖、回复、表单提交），用在 device_action 的 tab_act 为它回了 submit_needs_you 以后。写清网站、发给谁、'
      + '原文。他的承诺和授权（可以先 grant_list 看）已经覆盖就直接发；没覆盖他会收到一张卡，授权这一整件事（这个网站、这段原文、这件事做着的时候），之后在范围里再发不再问。付款、删除、改设置不能用它：'
      + '那些每次照旧走 page_submit_ask。',
    replay: 'once',
    effect: 'external',
    permission: 'agreement',
    roles: ['conversation', 'worker'],
    timeoutMs: PAGE_SEND_TIMEOUT_MS,
    parameters: Parameters,
    outbound: (args) => ({ channel: webChannel(args.site), account: webChannel(args.site),
      recipients: [args.to.trim()], category: PAGE_SEND_CATEGORY, content: args.text.trim() }),
    async execute(args, context) {
      if (!context.runId.startsWith(LINE_RUN_PREFIX)) {
        throw new ToolFailure('网页发送只在对话线里用。');
      }
      const lineId = context.runId.slice(LINE_RUN_PREFIX.length);
      const hold = submitHoldForRun(state, context.runId, args.nodeId, args.tabId);
      if (hold === null || hold.version !== args.version) {
        throw new ToolFailure('这个标签这一版页面上没有被拦下的发送：先用 tab_act 点发送，被拦下后再调 page_send。');
      }
      if (!PAGE_SEND_KINDS.includes(hold.kind)) {
        throw new ToolFailure('拦下的是付款、删除或改设置，不是发出去：用 page_submit_ask 问他。');
      }
      const trace = tabTrace(state, context.runId, args.nodeId, args.tabId);
      const host = trace.url === null ? null : hostOf(trace.url);
      if (host === null || webChannel(host) !== webChannel(args.site)) {
        throw new ToolFailure(`这一页不在 ${args.site} 上（现在是 ${host ?? '没读到地址'}），没有发。`);
      }
      if (trace.unverifiedPaste) {
        throw new ToolFailure(UNVERIFIED_PASTE);
      }
      if (trace.filled !== null && trace.filled.trim() !== args.text.trim()) {
        throw new ToolFailure('输入框里填的和要发的原文不一样，没有发：照填进去的原样写 text，或者重新填。');
      }
      const log = state.outboundLog.forCall(lineId, context.callId);
      if (log === undefined) {
        throw new ToolFailure('这次发送没有经过授权核对，没有发。');
      }
      const request: Omit<ActionRequest, 'actionId'> = { nodeId: args.nodeId, purpose: `发给${args.to}`,
        origin: 'brain', taskId: null, runId: context.runId, signal: context.signal,
        action: { kind: 'tab_act', tabId: args.tabId, version: args.version, act: { op: hold.op, n: hold.n },
          step: `发给${args.to}`.slice(0, 40), submitAsk: log.id } };
      const refusal = devices.submitRefusal(request) ?? devices.screen(request);
      if (refusal !== null) {
        throw new ToolFailure(`设备拒了（${REFUSAL_LAYER_LABELS[refusal.layer]}）：${refusal.reason}`);
      }
      const outcome = await devices.perform({ ...request, actionId: `${context.actionId}:send` });
      if (outcome.status === 'refused' || outcome.status === 'failed') {
        throw new ToolFailure(outcome.reason ?? '网页上这一下没发出去。');
      }
      if (outcome.status !== 'executed') {
        throw new ToolUncertain(outcome.reason ?? '还没拿到设备回执：先看页面上发出去没有，不要重发。');
      }
      return JSON.stringify({ sent: true, to: args.to, result: outcome.result,
        proof: proveDeviceAction(request.action, outcome.result) });
    },
  });
}
