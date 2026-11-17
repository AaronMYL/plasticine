// 旧的「看一眼」不留在上下文里（内核优化第一批，11-17）：页面结构、截图、设备和别的线的状态这类「当时的样子」，过一阵
// 就不作数了，却一直占着上下文——线上后台线 100 步以后平均每次请求带 16 万 token。做法参考 Hermes 压缩前先清旧的
// 工具结果：不调模型，只在装上下文时把较早的那些换成一行；库里的消息原样不动，界面照旧读库，要现在的样子重新看一次。
// 「较早」的界线按批往前推（每多 STALE_STEP_MESSAGES 条消息推一次），不是每一步都改前面的内容：前面的内容一改，
// 提供商那边这条线的缓存就失效一次。读正文的结果（文档、网页全文、按段取的全文）不算「看一眼」，不收。

import type { ToolResultMessage } from '@earendil-works/pi-ai';

/** 最近这么多条消息里的结果原样留着（一步是一条回答加一条结果，约十几步）。 */
export const STALE_KEEP_MESSAGES = 30;
/** 界线每多这么多条消息往前推一次。 */
export const STALE_STEP_MESSAGES = 40;

export const STALE_SNAPSHOT_NOTE = '［这是较早的一次查看，内容已收起：当时的样子现在不一定作数，要用就重新看一次。］';
export const STALE_IMAGE_NOTE = '［这一步当时带的图已收起，要看重新截一张。］';

// 只列「看当时样子」的工具：读线、列线、设备和云端浏览器的状态、命令的输出。
const SNAPSHOT_TOOLS: ReadonlySet<string> = new Set(['cloud_browser_observe', 'cloud_browser_tabs', 'read_line',
  'list_lines', 'server_command_read', 'device_nodes', 'device_logs']);
// device_action 里「看当时样子」的动作；tab_read 读的是正文（会接着按段读），不算。
const SNAPSHOT_ACTIONS: ReadonlySet<string> = new Set(['tab_perceive', 'tab_shot', 'tab_list', 'screen_capture',
  'app_perceive', 'device_state']);

/** 一次工具调用里这里用得到的两样（pi 的 AgentToolCall 也是这个形状）。 */
export interface CallLike {
  name: string;
  arguments: unknown;
}

function actionKind(args: unknown): string | null {
  if (typeof args !== 'object' || args === null) {
    return null;
  }
  const action: unknown = Reflect.get(args, 'action');
  const kind: unknown = typeof action === 'object' && action !== null ? Reflect.get(action, 'kind') : undefined;
  return typeof kind === 'string' ? kind : null;
}

/** 这次调用是不是「看一眼当时的样子」。 */
export function isSnapshotCall(call: CallLike): boolean {
  if (SNAPSHOT_TOOLS.has(call.name)) {
    return true;
  }
  const kind = call.name === 'device_action' ? actionKind(call.arguments) : null;
  return kind !== null && SNAPSHOT_ACTIONS.has(kind);
}

/** 界线：seq 不大于它的算「较早」。还没攒够一批是 0（什么都不收）。 */
export function staleBoundary(lastSeq: number): number {
  const prunable = lastSeq - STALE_KEEP_MESSAGES;
  return prunable <= 0 ? 0 : Math.floor(prunable / STALE_STEP_MESSAGES) * STALE_STEP_MESSAGES;
}

/**
 * 较早的结果送给模型的样子：「看一眼」的整个换成一行；别的结果只把图收起，文字原样。不在界线之内的原样返回。
 * call 是这条结果对应的那次调用（找不到时只收图）。
 */
export function collapseStale(message: ToolResultMessage, call: CallLike | undefined, seq: number, boundary: number)
  : ToolResultMessage {
  if (seq > boundary) {
    return message;
  }
  if (call !== undefined && isSnapshotCall(call)) {
    return { ...message, content: [{ type: 'text', text: STALE_SNAPSHOT_NOTE }] };
  }
  if (!message.content.some((part) => part.type === 'image')) {
    return message;
  }
  const texts = message.content.filter((part) => part.type === 'text');
  return { ...message, content: [...texts, { type: 'text', text: STALE_IMAGE_NOTE }] };
}
