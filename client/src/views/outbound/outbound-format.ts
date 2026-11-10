import type { OutboundGrant, OutboundGrantInput, OutboundLog, OutboundScope } from '../../api/shared.ts';

export const MAIN_ACTOR = 'line-main';
export interface ActorChoice { id: string; label: string; disabled?: boolean }
export interface BindingChoice { id: string; kind: 'line' | 'schedule' | 'project'; label: string }
export const SCOPE_LABELS = { once: '仅这一次', task: '这件事期间', always: '一直允许' } as const;
export const LOG_LABELS: Record<OutboundLog['status'], string> = {
  pending: '等待回执', queued: '等待发送', sent: '已发出', completed: '执行完成', failed: '发送失败', unknown: '结果待核实',
};
const CHANNELS: Record<string, string> = {
  'cyberhunter.contact': '联系人', 'cyberhunter.group': '群组', 'douyin.dm': '抖音私信', 'mail.reply': '邮件回复',
};
const CATEGORIES: Record<string, string> = { task_card: '任务卡', message: '消息', reply: '回复', emoji: '表情', fixed: '固定文案' };

export function channelLabel(value: string): string { return CHANNELS[value] ?? value; }
export function categoryLabel(value: string): string { return CATEGORIES[value] ?? value; }
export function actorLabel(id: string, actors: readonly ActorChoice[] = []): string {
  return actors.find((actor) => actor.id === id)?.label ?? (id === MAIN_ACTOR ? 'Plasticine（主线）' : '当前队友');
}
export function bindingKey(binding: { kind: string; id: string }): string { return `${binding.kind}:${binding.id}`; }
export function scopeLabel(scope: OutboundScope): string { return SCOPE_LABELS[scope.kind]; }
export function grantInput(row: OutboundGrant): OutboundGrantInput {
  const { actor, channel, account, recipientMode, recipients, category, fixedTexts, scope, expiresAt } = row;
  return { actor, channel, account, recipientMode, recipients, category, fixedTexts, scope, expiresAt };
}
export function validGrant(value: OutboundGrantInput): boolean {
  return [value.actor, value.channel, value.account, value.category].every((item) => item.trim() !== '')
    && (value.recipientMode === 'all' || value.recipients.length > 0 && value.recipients.every(Boolean))
    && (value.fixedTexts === null
      || value.fixedTexts.length > 0 && value.fixedTexts.every((text) => text.trim() !== ''))
    && (value.scope.kind !== 'task' || value.scope.binding.id !== ''
      && !(value.scope.binding.kind === 'line' && value.scope.binding.id === MAIN_ACTOR));
}
export function grantEnded(row: OutboundGrant, now = Date.now()): boolean {
  return row.revokedAt !== null || row.scope.kind === 'once' && row.usedCount > 0
    || row.expiresAt !== null && Date.parse(row.expiresAt) <= now;
}
export function recipientLabel(value: Pick<OutboundGrantInput, 'recipientMode' | 'recipients'>,
  names: ReadonlyMap<string, string>): string {
  if (value.recipientMode === 'all') { return '这个渠道的所有对象'; }
  if (value.recipients.length === 1) { return names.get(value.recipients[0]!) ?? value.recipients[0]!; }
  return `${value.recipients.length} 位对象`;
}
