import type { ToolResultMessage } from '@earendil-works/pi-ai';

export const STALE_KEEP_MESSAGES = 30;
export const STALE_STEP_MESSAGES = 40;

export const STALE_SNAPSHOT_NOTE = '［这是较早的一次查看，内容已收起：当时的样子现在不一定作数，要用就重新看一次。］';
export const STALE_IMAGE_NOTE = '［这一步当时带的图已收起，要看重新截一张。］';

const SNAPSHOT_TOOLS: ReadonlySet<string> = new Set(['cloud_browser_observe', 'cloud_browser_tabs', 'read_line',
  'list_lines', 'server_command_read', 'device_nodes', 'device_logs']);
const SNAPSHOT_ACTIONS: ReadonlySet<string> = new Set(['tab_perceive', 'tab_shot', 'tab_list', 'screen_capture',
  'app_perceive', 'device_state']);

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

export function isSnapshotCall(call: CallLike): boolean {
  if (SNAPSHOT_TOOLS.has(call.name)) {
    return true;
  }
  const kind = call.name === 'device_action' ? actionKind(call.arguments) : null;
  return kind !== null && SNAPSHOT_ACTIONS.has(kind);
}

export function staleBoundary(lastSeq: number): number {
  const prunable = lastSeq - STALE_KEEP_MESSAGES;
  return prunable <= 0 ? 0 : Math.floor(prunable / STALE_STEP_MESSAGES) * STALE_STEP_MESSAGES;
}

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
