import type { AgentTool } from '@earendil-works/pi-agent-core';
import { Type } from 'typebox';
import { MAIN_THREAD_PATH } from '../../shared/api/push.ts';
import { pushTag, type PushRecord } from '../../shared/api/pushes.ts';
import { checkedArgs, type KernelTool, type LineScope } from '../lines/index.ts';
import type { LineRow, PushRow, StateService } from '../state/index.ts';

const TITLE_MAX_CHARS = 60;

const PushParameters = Type.Object({
  title: Type.String({ minLength: 2, maxLength: TITLE_MAX_CHARS,
    description: '推到他手机上的那一句：说清是什么事（「示例科技回你了」「公众号第一篇排好了，等你预览」）。'
      + '不写密码、验证码、金额明细这类私密内容。' }),
}, { additionalProperties: false });

type PushState = Pick<StateService, 'pushes' | 'lines' | 'mates'>;

export interface PushToolParts {
  state: PushState;
  announce(input: { body: string; url: string; tag: string }): void;
  changed(): void;
}

export function conversationPath(line: LineRow | undefined): string {
  if (line === undefined || line.kind === 'main') return MAIN_THREAD_PATH;
  if (line.mateId != null && line.kind !== 'background') return `/#/plasticine/mate/${encodeURIComponent(line.mateId)}`;
  if (line.kind === 'side') return `/#/plasticine/side/${encodeURIComponent(line.id)}`;
  return `/#/work/${encodeURIComponent(line.id)}`;
}

export function pushRecord(state: PushState, row: PushRow): PushRecord {
  const line = state.lines.get(row.lineId);
  const mate = line?.mateId == null ? undefined : state.mates.get(line.mateId);
  const from = line === undefined || line.kind === 'main' ? '主线' : mate?.name ?? line.title;
  return { id: row.id, title: row.title, from, lineId: row.lineId, url: row.url, createdAt: row.createdAt,
    withdrawnAt: row.withdrawnAt };
}

function createPush(parts: PushToolParts, scope: LineScope): AgentTool<typeof PushParameters> {
  return {
    name: 'push_notify',
    label: '推到手机',
    description: '把一件要他马上知道的事推到他手机（系统通知）：对方回了、等他确认、做完了要他看。只一句话，点开到这段对话。'
      + '不急的不推（照常在对话里说）；同一件事不重复推。他能在记忆 · 主动告诉你里看到和撤回。',
    parameters: PushParameters,
    replay: 'safe',
    async execute(toolCallId, raw) {
      const args = checkedArgs(PushParameters, raw, 'push_notify');
      const url = conversationPath(parts.state.lines.get(scope.lineId));
      const { push, created } = parts.state.pushes.add({ lineId: scope.lineId, callKey: `${scope.lineId}:${toolCallId}`,
        title: args.title.trim(), url });
      if (created) {
        parts.announce({ body: push.title, url: push.url, tag: pushTag(push.id) });
        parts.changed();
      }
      return { content: [{ type: 'text', text: JSON.stringify({ id: push.id, pushed: true }) }], details: {} };
    },
  };
}

export function pushTool(parts: PushToolParts): KernelTool {
  return {
    name: 'push_notify',
    say: (args) => `推到你手机：${String(args['title'] ?? '')}`,
    hardLine: () => null,
    create: (scope) => createPush(parts, scope),
  };
}
