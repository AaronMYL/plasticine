// 假的约定栏：按放进来的顺序当作新的在前，翻页、详情（历史、≠ 标记），和设备确认（confirm，经 fake-signed.ts
// 核实本人会话才调到这里）。迁移来的约定一开始就生效，但「迁移来的、待你确认」，确认或撤之后才不是（第 82 条）。

import type { AgreementsApi } from '../client.ts';
import { ApiError, ConflictError } from '../errors.ts';
import { COGNITION_PAGE_DEFAULT } from '../shared.ts';
import type { CreateTermRequest, ProposeTermRequest, TermDecodingList } from '../shared.ts';
import { proposedAgreementText } from '../shared.ts';
import type {
  AgreementDetail,
  AgreementListQuery,
  AgreementListResponse,
  AgreementView,
  ChangeRecordView,
  ConfirmAgreementRequest,
} from '../types.ts';
import { agreementView, type AgreementSeed } from './cognition-views.ts';
import type { FakeEventBus } from './event-bus.ts';
import type { FakeSession } from './fake-session.ts';
import { changeRecord } from './history.ts';

export interface FakeAgreementsDeps {
  session: FakeSession;
  bus: FakeEventBus;
  now: () => Date;
}

export class FakeAgreements implements AgreementsApi {
  all(): AgreementView[] { return structuredClone([...this.rows.values()]); }
  private readonly rows = new Map<string, AgreementView>();
  private readonly history = new Map<string, ChangeRecordView[]>();
  private readonly deps: FakeAgreementsDeps;
  private readonly writes = new Map<string, AgreementView>();

  constructor(deps: FakeAgreementsDeps) {
    this.deps = deps;
  }

  async create(input: CreateTermRequest): Promise<AgreementView> {
    this.deps.session.require();
    const previous = this.writes.get(input.requestId);
    if (previous !== undefined) {
      return previous;
    }
    const { requestId, ...fields } = input;
    const row = this.seed({ ...fields, id: `term-${requestId}`, state: 'under_review' });
    this.writes.set(requestId, row);
    this.deps.bus.emit({ type: 'agreement.changed', agreement: row });
    return row;
  }

  async propose(id: string, input: ProposeTermRequest): Promise<AgreementView> {
    this.deps.session.require();
    const previous = this.writes.get(input.requestId);
    if (previous !== undefined) {
      return previous;
    }
    const current = this.require(id);
    if (current.version !== input.version) {
      throw new ConflictError(current, '词语已经改过，请重新读取后再保存。', undefined);
    }
    const { requestId, version: _version, ...proposedTerm } = input;
    const row = this.changeElsewhere(id, { proposedTerm, proposedDiff: `+ ${proposedTerm.text}` });
    this.writes.set(requestId, row);
    return row;
  }

  async decodings(id: string): Promise<TermDecodingList> {
    this.deps.session.require();
    this.require(id);
    return { decodings: [] };
  }

  async list(query: AgreementListQuery): Promise<AgreementListResponse> {
    this.deps.session.require();
    return this.page(query);
  }

  /** /v2/memory 里约定栏的第一页。 */
  page(query: AgreementListQuery): AgreementListResponse {
    const limit = query.limit ?? COGNITION_PAGE_DEFAULT;
    const offset = query.offset ?? 0;
    const all = [...this.rows.values()].filter((row) => {
      const stateMatches = query.state === undefined || row.state === query.state;
      return stateMatches && (query.kind === undefined || row.kind === query.kind);
    });
    const agreements = all.slice(offset, offset + limit);
    return { agreements, nextOffset: offset + limit < all.length ? offset + limit : null };
  }

  async get(id: string): Promise<AgreementDetail> {
    this.deps.session.require();
    const agreement = this.require(id);
    return {
      agreement,
      history: this.history.get(id) ?? [],
    };
  }

  seed(seed: AgreementSeed): AgreementView {
    const row = agreementView(seed);
    this.rows.set(row.id, row);
    const actor = row.migrated ? 'migration' : 'user';
    const first = changeRecord({ version: 1, actor, reason: '记下这条约定', fields: [], at: row.createdAt });
    this.history.set(row.id, [first]);
    return row;
  }

  /** 测试：另一台设备改了它（版本加一）；emit = false 时事件没到这边（断线）。 */
  changeElsewhere(id: string, patch: Partial<Omit<AgreementView, 'id' | 'version'>>, emit = true): AgreementView {
    const current = this.require(id);
    const next = { ...current, ...patch, version: current.version + 1, updatedAt: this.deps.now().toISOString() };
    this.rows.set(id, next);
    if (emit) {
      this.deps.bus.emit({ type: 'agreement.changed', agreement: next });
    }
    return next;
  }

  find(id: string): AgreementView | undefined {
    return this.rows.get(id);
  }

  activeRows(): AgreementView[] {
    return [...this.rows.values()].filter((row) => row.state === 'active');
  }

  /** 本人确认：会话已经核实。版本不对是 409 带 current，和真服务端一样。 */
  confirm(id: string, body: ConfirmAgreementRequest): AgreementView {
    const current = this.require(id);
    if (current.version !== body.version) {
      const next = '看 current 里的最新版，确认的是它再来。';
      throw new ConflictError(current, '这条约定在别处改过了，这次没有确认。', next);
    }
    const at = this.deps.now().toISOString();
    const confirm = body.decision === 'confirm' || body.decision === 'adopt';
    const text = body.decision === 'adopt'
      ? proposedAgreementText(current.text, current.proposedDiff ?? '') : current.text;
    if (text === null) {
      throw new ApiError({ kind: 'failed', code: 'invalid_diff', status: 409, message: '提议与原文对不上。' });
    }
    const keep = current.state === 'active' && current.effectiveAt !== null;
    const next: AgreementView = {
      ...current,
      ...(confirm && current.proposedTerm != null ? current.proposedTerm : {}),
      proposedTerm: confirm ? null : (current.proposedTerm ?? null),
      text: confirm && current.proposedTerm != null ? current.proposedTerm.text : text,
      proposedDiff: null,
      state: body.decision === 'reject' ? current.state : confirm ? 'active' : 'revoked',
      effectiveAt: confirm ? (keep ? current.effectiveAt : at) : current.effectiveAt,
      awaitingConfirmation: body.decision === 'reject' ? current.awaitingConfirmation : false,
      confirmedByDeviceAt: body.decision === 'reject' ? current.confirmedByDeviceAt : at,
      updatedAt: at,
      version: current.version + (confirm && current.proposedTerm != null ? 2 : 1),
    };
    this.rows.set(id, next);
    const reason = body.reason ?? (confirm ? '用户在设备上确认这条约定生效' : '用户在设备上撤了这条约定');
    const record = changeRecord({ version: next.version, actor: 'user', reason, fields: ['state'], at });
    this.history.set(id, [...(this.history.get(id) ?? []), { ...record, confirmedByDevice: true }]);
    this.deps.bus.emit({ type: 'agreement.changed', agreement: next });
    return next;
  }

  edit(id: string, version: number, text: string, scope: string): AgreementView {
    this.deps.session.requireUser();
    const current = this.require(id);
    if (current.version !== version) {
      throw new ConflictError(current, '这条约定在别处改过了。', '对照新版再保存。');
    }
    return this.changeElsewhere(id, { text, scope,
      confirmedByDeviceAt: this.deps.now().toISOString() });
  }


  private require(id: string): AgreementView {
    const row = this.rows.get(id);
    if (row === undefined) {
      throw new ApiError({ kind: 'not_found', code: 'not_found', message: '没有找到这条约定。', status: 404 });
    }
    return row;
  }
}
