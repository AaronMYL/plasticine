import type { OutboundGrant, OutboundGrantInput, OutboundLog } from '../shared.ts';
import type { AskSeed } from './fake-asks.ts';
import { MAIN_LINE_ID, type FakeLines } from './fake-lines.ts';
import type { FakeOutbound } from './fake-outbound.ts';

export const OUTBOUND_DEMO: OutboundGrantInput = {
  actor: MAIN_LINE_ID, channel: 'cyberhunter.contact', account: '@studio-example', recipientMode: 'list',
  recipients: ['contact-fern', 'contact-river'], category: 'task_card', fixedTexts: null,
  scope: { kind: 'once' }, expiresAt: null,
};
export function outboundGrant(now: Date, patch: Partial<OutboundGrant> = {}): OutboundGrant {
  const at = now.toISOString();
  return { ...OUTBOUND_DEMO, id: 'grant-studio', version: 1, createdAt: at, updatedAt: at,
    scope: { kind: 'always' }, enabled: true, revokedAt: null, usedCount: 4, lastUsedAt: at,
    confirmedByDeviceId: 'device-demo', confirmedAt: at, sourceAskId: null, legacyScheduleId: null, ...patch };
}
export function outboundLog(now: Date, patch: Partial<OutboundLog> = {}): OutboundLog {
  return { id: 'outbound-log-demo', grantId: 'grant-studio', actor: MAIN_LINE_ID, lineId: MAIN_LINE_ID,
    toolCallId: 'call-demo', toolName: 'send_task_card', argsDigest: 'fixture-digest',
    channel: OUTBOUND_DEMO.channel, account: OUTBOUND_DEMO.account, recipients: OUTBOUND_DEMO.recipients,
    category: OUTBOUND_DEMO.category, content: '请帮忙校对工作室周报，周五前给我修改意见。',
    status: 'sent', summary: '对方设备已接收。', sourceRef: null,
    createdAt: now.toISOString(), finishedAt: now.toISOString(), ...patch };
}
export function outboundAsk(): AskSeed {
  return { id: 'ask-outbound-demo', kind: 'approve', question: '把周报任务发给两位联系人',
    detail: '会以你的名义发出，对方会收到，撤不回。', lineId: MAIN_LINE_ID, basis: 'hard_line',
    options: [{ id: 'allow', label: '授权并发出', description: null, recommended: true },
      { id: 'revise', label: '改一下', description: null, recommended: false },
      { id: 'deny', label: '先不', description: null, recommended: false }],
    outbound: { grant: OUTBOUND_DEMO, relatedGrantId: null, requested: {
      channel: OUTBOUND_DEMO.channel, account: OUTBOUND_DEMO.account, recipients: OUTBOUND_DEMO.recipients,
      category: OUTBOUND_DEMO.category, content: '请帮忙校对工作室周报，周五前给我修改意见。',
    } } };
}
export function seedOutboundScene(lines: FakeLines, outbound: FakeOutbound, raise: (seed: AskSeed) => void,
  now: Date): void {
  outbound.seed([outboundGrant(now), outboundGrant(now, { id: 'grant-expired', usedCount: 1,
    scope: { kind: 'once' }, category: 'message', recipients: ['contact-fern'] })], [outboundLog(now),
    outboundLog(now, { id: 'outbound-log-unknown', status: 'unknown',
      summary: '没有收到可核对的发送回执。', finishedAt: null, content: '周报初稿已经整理好，请查收。' })]);
  const text = '把这份周报校对任务发给两位联系人，之后这类任务也可以直接发。';
  lines.record(MAIN_LINE_ID, { role: 'user', text, origin: { kind: 'user', userText: text },
    thinking: null, thinkingMs: null, steps: [], toolCallId: null, tool: null, say: null, ok: null,
    summary: null, stopReason: null, childLineId: null, attachments: [], widgets: [], createdAt: now.toISOString() });
  lines.change(MAIN_LINE_ID, { status: 'waiting', activity: null, activeSince: now.toISOString() });
  raise(outboundAsk());
}
