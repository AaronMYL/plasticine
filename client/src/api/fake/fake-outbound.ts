import type { OutboundApi } from '../outbound-client.ts';
import type { CreateOutboundGrantRequest, EditOutboundGrantRequest, RevokeOutboundGrantRequest,
  OutboundCard, OutboundGrant, OutboundGrantInput, OutboundLog } from '../shared.ts';
import { ApiError, ConflictError } from '../errors.ts';
import type { FakeSession } from './fake-session.ts';
import type { FakeReceipts } from './receipts.ts';

export class FakeOutbound implements OutboundApi {
  private readonly rows = new Map<string, OutboundGrant>();
  private readonly entries = new Map<string, OutboundLog>();
  private readonly session: FakeSession;
  private readonly receipts: FakeReceipts;
  private readonly now: () => Date;
  private sequence = 0;

  constructor(session: FakeSession, receipts: FakeReceipts, now: () => Date) {
    this.session = session; this.receipts = receipts; this.now = now;
  }
  seed(grants: readonly OutboundGrant[], logs: readonly OutboundLog[] = []): void {
    for (const row of grants) { this.rows.set(row.id, structuredClone(row)); }
    for (const row of logs) { this.entries.set(row.id, structuredClone(row)); }
  }
  async grants(): Promise<OutboundGrant[]> {
    this.session.require();
    return structuredClone([...this.rows.values()]);
  }
  async logs(): Promise<OutboundLog[]> {
    this.session.require();
    return structuredClone([...this.entries.values()]);
  }
  async log(id: string): Promise<OutboundLog> {
    this.session.require();
    const row = this.entries.get(id);
    if (row === undefined) { throw this.invalid('没有这条发送记录。'); }
    return structuredClone(row);
  }
  async create(input: CreateOutboundGrantRequest): Promise<OutboundGrant> {
    this.session.requireUser();
    return this.receipts.run('save', input.requestId, `outbound:create:${JSON.stringify(input)}`,
      () => this.add(input.grant));
  }
  async edit(id: string, input: EditOutboundGrantRequest): Promise<OutboundGrant> {
    this.session.requireUser();
    return this.receipts.run('save', input.requestId, `outbound:edit:${id}:${JSON.stringify(input)}`, () => {
      const current = this.require(id, input.version);
      if (current.revokedAt !== null) { throw this.invalid('已经撤销的授权不能恢复。'); }
      if (current.legacyScheduleId !== null && Object.keys(input.patch).some((key) => key !== 'enabled')) {
        throw this.invalid('原定时任务的授权只能停用或撤销。');
      }
      const row = { ...current, ...input.patch, version: current.version + 1, updatedAt: this.now().toISOString() };
      this.check(row);
      this.rows.set(id, row);
      return structuredClone(row);
    });
  }
  async revoke(id: string, input: RevokeOutboundGrantRequest): Promise<OutboundGrant> {
    this.session.requireUser();
    return this.receipts.run('save', input.requestId, `outbound:revoke:${id}:${JSON.stringify(input)}`, () => {
      const before = this.require(id, input.version);
      const row = { ...before, enabled: false, revokedAt: this.now().toISOString(), version: before.version + 1 };
      this.rows.set(id, row);
      return structuredClone(row);
    });
  }
  authorize(card: OutboundCard, selected: OutboundGrantInput, option: string): void {
    if (option === 'extend' && card.relatedGrantId !== null) {
      const before = this.require(card.relatedGrantId);
      this.rows.set(before.id, { ...before, ...selected, version: before.version + 1 });
    } else if (option === 'allow' || option === 'once') {
      this.add(option === 'once' ? { ...selected, scope: { kind: 'once' },
        recipientMode: 'list', recipients: card.requested.recipients,
        fixedTexts: [card.requested.content] } : selected);
    }
  }
  private add(input: OutboundGrantInput): OutboundGrant {
    this.check(input);
    const at = this.now().toISOString();
    const row: OutboundGrant = { ...input, id: `outbound-${++this.sequence}`, version: 1, createdAt: at, updatedAt: at,
      enabled: true, revokedAt: null, usedCount: 0, lastUsedAt: null, confirmedAt: at,
      confirmedByDeviceId: this.session.currentSession()?.device.id ?? 'fixture-device',
      sourceAskId: null, legacyScheduleId: null };
    this.rows.set(row.id, row);
    return structuredClone(row);
  }
  private check(input: OutboundGrantInput): void {
    if (input.recipientMode === 'list' && input.recipients.length === 0) { throw this.invalid('请选择发送对象。'); }
    if (input.scope.kind === 'task' && input.scope.binding.kind === 'line' && input.scope.binding.id === 'line-main') {
      throw this.invalid('任务期间不能绑定常驻主线。');
    }
  }
  private require(id: string, version?: number): OutboundGrant {
    const row = this.rows.get(id);
    if (row === undefined) { throw this.invalid('没有这条对外授权。'); }
    if (version !== undefined && row.version !== version) {
      throw new ConflictError(row, '授权在别处改过，请再读一次后再改。', '再读一次授权。');
    }
    return row;
  }
  private invalid(message: string): ApiError {
    return new ApiError({ kind: 'invalid', code: 'invalid_input', status: 400, message });
  }
}
