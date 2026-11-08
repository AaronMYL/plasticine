import type { MoneyDraftsApi } from '../client.ts';
import { ApiError } from '../errors.ts';
import {
  EMPTY_PAYMENT_CANDIDATE,
  type CreateMoneyDraftRequest,
  type EditMoneyDraftRequest,
  type MoneyDraftView,
  type ConfirmMoneyDraftRequest,
  type MoneyDraftSummary,
  type PurgeOriginalsRequest,
  type PurgeOriginalsResponse,
  type RejectMoneyDraftRequest,
} from '../shared.ts';
import type { FakeAttachments } from './fake-attachments.ts';
import type { FakeAsks } from './fake-asks.ts';
import type { FakeMoney } from './fake-money.ts';
import type { FakeSession } from './fake-session.ts';
import type { FakeReceipts } from './receipts.ts';
import type { FakeEventBus } from './event-bus.ts';

interface Options {
  session: FakeSession;
  receipts: FakeReceipts;
  bus: FakeEventBus;
  now: () => Date;
  attachments: FakeAttachments;
  asks: FakeAsks;
  money: FakeMoney;
}
const conflict = () =>
  new ApiError({
    kind: 'conflict',
    code: 'version_conflict',
    status: 409,
    message: '草案或确认卡已经变动，请先读取最新版。',
  });

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * 假接口没有截图识别：新建的草案一律当成「金额看不清」出卡（第二批里仍要问你的那种）。直接入账的那些由 seedWeek
 * 摆进每周汇总（和种子账本里标「待你看一眼」的几笔对得上）。
 */
export class FakeMoneyDrafts implements MoneyDraftsApi {
  private readonly options: Options;
  private readonly rows = new Map<string, MoneyDraftView>();
  private seeded: MoneyDraftSummary | null = null;
  constructor(options: Options) {
    this.options = options;
  }
  /** 种子：这周截图直接记下的几笔（原图还留着）。 */
  seedWeek(recorded: number, review: number): void {
    const since = new Date(this.options.now().getTime() - WEEK_MS).toISOString();
    this.seeded = { since, recorded, review, originals: recorded };
  }
  async summary(): Promise<MoneyDraftSummary> {
    this.options.session.require();
    const since = new Date(this.options.now().getTime() - WEEK_MS).toISOString();
    const recorded = [...this.rows.values()].filter((row) => row.status === 'confirmed');
    const kept = recorded.filter((row) => this.keptOriginal(row.attachmentId));
    return {
      since,
      recorded: (this.seeded?.recorded ?? 0) + recorded.filter((row) => row.updatedAt >= since).length,
      review: this.seeded?.review ?? 0,
      originals: (this.seeded?.originals ?? 0) + kept.length,
    };
  }
  async purgeOriginals(body: PurgeOriginalsRequest): Promise<PurgeOriginalsResponse> {
    this.options.session.require();
    return this.options.receipts.run('money', body.requestId, 'originals:purge', () => {
      const kept = [...this.rows.values()].filter((row) => row.status === 'confirmed'
        && this.keptOriginal(row.attachmentId));
      for (const row of kept) {
        const attachment = this.options.attachments.purge(row.attachmentId, '已记账付款截图');
        this.options.bus.emit({ type: 'attachment.changed', attachment });
      }
      const purged = kept.length + (this.seeded?.originals ?? 0);
      if (this.seeded !== null) {
        this.seeded = { ...this.seeded, originals: 0 };
      }
      return { purged };
    });
  }
  private keptOriginal(attachmentId: string): boolean {
    return this.options.attachments.peek(attachmentId)?.status === 'ready';
  }
  async create(input: CreateMoneyDraftRequest): Promise<MoneyDraftView> {
    const { session, receipts, attachments, asks, now } = this.options;
    session.require();
    return receipts.run('money', input.requestId, `draft:create:${JSON.stringify(input)}`, () => {
      const previous = [...this.rows.values()].find((row) => row.attachmentId === input.attachmentId);
      if (previous !== undefined) {
        return previous;
      }
      const image = attachments.require(input.attachmentId);
      if (image.status !== 'ready' || !image.mimeType.startsWith('image/')) {
        throw conflict();
      }
      const id = `draft-${input.requestId}`;
      const askId = `ask-${id}`;
      const at = now().toISOString();
      const row: MoneyDraftView = {
        id,
        version: 1,
        requestId: input.requestId,
        attachmentId: image.id,
        messageId: input.messageId,
        status: 'ready',
        candidate: { ...EMPTY_PAYMENT_CANDIDATE },
        askId,
        askVersion: 1,
        runId: null,
        entryId: null,
        duplicateEntryId: null,
        error: null,
        confirmedByDeviceId: null,
        createdAt: at,
        updatedAt: at,
      };
      this.rows.set(id, row);
      asks.raise({
        id: askId,
        kind: 'confirm',
        question: '核对这笔账',
        moneyDraftId: id,
        options: [
          { id: 'confirm', label: '确认记账', recommended: false, description: null },
          { id: 'reject', label: '不记这笔', recommended: false, description: null },
        ],
      });
      return row;
    });
  }
  async get(id: string): Promise<MoneyDraftView> {
    this.options.session.require();
    const row = this.require(id);
    return { ...row, askVersion: row.askId === null ? null : (await this.options.asks.get(row.askId)).version };
  }
  async edit(id: string, body: EditMoneyDraftRequest): Promise<MoneyDraftView> {
    this.options.session.require();
    return this.options.receipts.run('money', body.requestId, `draft:${id}:${JSON.stringify(body)}`, () => {
      const row = this.writable(id, body.version);
      const ask = this.options.asks.touch(row.askId ?? '');
      return this.save({ ...row, candidate: body.candidate, askVersion: ask.version });
    });
  }
  async reject(id: string, body: RejectMoneyDraftRequest): Promise<MoneyDraftView> {
    this.options.session.require();
    return this.options.receipts.run('money', body.requestId, `reject:${id}:${JSON.stringify(body)}`, () => {
      const row = this.writable(id, body.version);
      const ask = this.options.asks.answerElsewhere(row.askId ?? '', 'reject');
      return this.save({ ...row, status: 'rejected', askVersion: ask.version });
    });
  }
  confirm(id: string, body: ConfirmMoneyDraftRequest): MoneyDraftView {
    const row = this.require(id);
    const fields = body.fields;
    if (!(Object.keys(fields) as (keyof typeof fields)[]).every((key) => row.candidate[key] === fields[key])) {
      throw conflict();
    }
    if (row.status === 'confirmed') {
      return row;
    }
    this.writable(id, body.version);
    if (row.askVersion !== body.askVersion) {
      throw conflict();
    }
    // 第二批：原图不再随确认删掉，留到你在每周汇总里清。
    const entry = this.options.money.recordConfirmed(`payment-${id}`, fields);
    const ask = this.options.asks.answerElsewhere(row.askId ?? '', 'confirm');
    return this.save({
      ...row,
      status: 'confirmed',
      candidate: { ...fields, basis: '', uncertainty: '' },
      entryId: entry.id,
      askVersion: ask.version,
    });
  }
  private require(id: string): MoneyDraftView {
    const row = this.rows.get(id);
    if (row === undefined) {
      throw new ApiError({ kind: 'not_found', code: 'not_found', message: '没有找到记账草案。', status: 404 });
    }
    return row;
  }
  private writable(id: string, version: number): MoneyDraftView {
    const row = this.require(id);
    if (row.version !== version || row.status === 'confirmed' || row.status === 'rejected') {
      throw conflict();
    }
    return row;
  }
  private save(row: MoneyDraftView): MoneyDraftView {
    const next = { ...row, version: row.version + 1, updatedAt: this.options.now().toISOString() };
    this.rows.set(next.id, next);
    this.options.bus.emit({ type: 'money-draft.changed', draft: next });
    return next;
  }
}
