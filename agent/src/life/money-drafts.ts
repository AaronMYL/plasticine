import { Value } from 'typebox/value';
import {
  PaymentFieldsSchema,
  type ConfirmMoneyDraftRequest,
  type CreateMoneyDraftRequest,
  type MoneyDraftSummary,
  type MoneyDraftView,
  type PaymentCandidate,
  type PaymentFields,
} from '../../shared/api/index.ts';
import type { MoneyDraft } from '../../shared/money-drafts.ts';
import type { DeviceConfirmation, MoneyCategory } from '../../shared/state.ts';
import type { AskDesk, AskResolver, AfterCommit, Changes } from '../attention/index.ts';
import { StateError, type StateService } from '../state/index.ts';
import type { MoneyDesk } from './money.ts';

interface Options {
  state: StateService;
  desk: AskDesk;
  money: MoneyDesk;
  now: () => Date;
  changed: (id: string) => void;
  attachmentChanged: (id: string) => void;
}
const FIELDS = ['amountCents', 'currency', 'merchant', 'occurredAt', 'kind', 'accountId', 'categoryId'] as const;
const SUMMARY_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

/** The fields a payment can be recorded with, or null while something it needs is unreadable. */
function readableFields(candidate: PaymentCandidate): PaymentFields | null {
  const { basis: _basis, uncertainty: _uncertainty, ...fields } = candidate;
  if (!Value.Check(PaymentFieldsSchema, fields)) {
    return null;
  }
  return { ...fields, occurredAt: new Date(fields.occurredAt).toISOString() };
}

export class MoneyDraftDesk {
  private readonly options: Options;
  constructor(options: Options) {
    this.options = options;
  }

  readonly resolver: AskResolver = {
    resolve: (_changes, ask) => {
      const id = ask.context?.['moneyDraftId'];
      const row = typeof id === 'string' ? this.options.state.moneyDrafts.get(id) : null;
      const expected = ask.answer?.optionId === 'confirm' ? 'confirmed' : 'rejected';
      if (row?.status !== expected) {
        throw new StateError('confirmation_required', '请在记账卡核对字段后确认。');
      }
    },
  };

  /** The categories the reading may pick from (the defaults are made the first time). */
  categories(): MoneyCategory[] {
    return this.options.money.categories();
  }

  view(id: string): MoneyDraftView {
    const row = this.options.state.moneyDrafts.require(id);
    return { ...row, askVersion: row.askId === null ? null : this.options.state.asks.require(row.askId).version };
  }

  request(input: CreateMoneyDraftRequest, after?: AfterCommit): MoneyDraftView {
    const { state, desk, changed } = this.options;
    return desk.commit((changes) => {
      const previous = state.moneyDrafts.byAttachment(input.attachmentId);
      if (previous !== null) {
        return this.view(previous.id);
      }
      const attachment = state.attachments.requireOwned(input.attachmentId, 'library-user');
      if (attachment.status !== 'ready' || !attachment.mimeType.startsWith('image/')) {
        throw new StateError('invalid_input', '请选择已就绪的付款截图。');
      }
      const row = state.moneyDrafts.create({ ...input, sha256: attachment.sha256 });
      changes.afterCommit(() => changed(row.id));
      return this.view(row.id);
    }, after);
  }

  /** What the reading found (or that it failed): record it directly, or ask only in the two cases that need you. */
  settle(id: string, version: number, candidate: PaymentCandidate, error: string | null): MoneyDraftView {
    const { state, desk } = this.options;
    const row = state.moneyDrafts.require(id);
    if (row.askId !== null) {
      return this.propose(id, version, candidate, error);
    }
    return desk.commit((changes) => {
      const fields = error === null ? readableFields(candidate) : null;
      const duplicate = row.duplicateEntryId ?? (fields === null ? null
        : state.moneyEntries.samePayment(fields)?.id ?? null);
      if (fields === null || duplicate !== null) {
        this.ask(changes, state.moneyDrafts.propose(id, version, candidate, error, duplicate));
      } else {
        this.recordDirectly(changes, row, fields, candidate.basis);
      }
      return this.view(id);
    });
  }
  propose(
    id: string,
    version: number,
    candidate: PaymentCandidate,
    error: string | null,
    after?: AfterCommit,
  ): MoneyDraftView {
    const { state, desk, changed } = this.options;
    return desk.commit((changes) => {
      const row = state.moneyDrafts.propose(id, version, candidate, error);
      if (row.askId !== null) {
        const ask = state.asks.require(row.askId);
        state.asks.update(ask.id, ask.version, { status: 'open' });
        changes.ask(ask.id, 'updated');
      }
      changes.afterCommit(() => changed(id));
      return this.view(id);
    }, after);
  }

  confirm(id: string, body: ConfirmMoneyDraftRequest, proof: DeviceConfirmation, after: AfterCommit): MoneyDraftView {
    const { state, desk, money, changed } = this.options;
    return desk.commit((changes) => {
      const row = state.moneyDrafts.require(id);
      if (!FIELDS.every((field) => row.candidate[field] === body.fields[field])) {
        throw new StateError('version_conflict', '签名字段与当前草案不同，请重新核对。');
      }
      if (row.status === 'confirmed') {
        return this.view(id);
      }
      this.checkCard(row, body.version, body.askVersion);
      const entry = money.record({ ...body.fields, origin: 'ai', review: false }, after);
      state.moneyDrafts.confirm(id, row.version, entry.id, body.fields, proof);
      desk.answerWithin(changes, {
        askId: row.askId ?? '',
        optionId: 'confirm',
        answerer: { deviceId: proof.deviceId },
      });
      changes.afterCommit(() => changed(id));
      return this.view(id);
    }, after);
  }

  reject(id: string, version: number, askVersion: number, deviceId: string, after: AfterCommit): MoneyDraftView {
    const { state, desk, changed } = this.options;
    return desk.commit((changes) => {
      const row = state.moneyDrafts.require(id);
      if (row.status === 'rejected') {
        return this.view(id);
      }
      this.checkCard(row, version, askVersion);
      state.moneyDrafts.reject(id, version);
      desk.answerWithin(changes, { askId: row.askId ?? '', optionId: 'reject', answerer: { deviceId } });
      changes.afterCommit(() => changed(id));
      return this.view(id);
    }, after);
  }

  purge(): void {
    try {
      this.options.state.attachments.purgePending();
    } catch (error) {
      safeLog('warn', 'payment_attachment_purge_failed', { category: errorCategory(error) });
    }
  }

  weekSummary(): MoneyDraftSummary {
    const { state, now } = this.options;
    const since = new Date(now().getTime() - SUMMARY_WINDOW_MS).toISOString();
    const recorded = state.moneyDrafts.recorded();
    const recent = recorded.filter((row) => row.updatedAt >= since);
    const review = recent.filter((row) => row.entryId !== null
      && state.moneyEntries.get(row.entryId)?.review === true).length;
    return { since, recorded: recent.length, review, originals: this.keptOriginals().length };
  }

  purgeOriginals(after: AfterCommit): number {
    const { state } = this.options;
    const kept = state.transaction(() => this.keptOriginals().map((row) => {
      const fields = readableFields(row.candidate);
      state.attachments.markForDeletion(row.attachmentId, fields === null ? '已记账付款截图' : this.summary(fields));
      return row.attachmentId;
    }));
    after(() => {
      this.purge();
      for (const attachmentId of kept) {
        this.options.attachmentChanged(attachmentId);
      }
    });
    return kept.length;
  }

  private keptOriginals(): MoneyDraft[] {
    return this.options.state.moneyDrafts.recorded()
      .filter((row) => this.options.state.attachments.get(row.attachmentId)?.status === 'ready');
  }

  private ask(changes: Changes, row: MoneyDraft): void {
    const { state, desk, changed } = this.options;
    const ask = desk.raise(changes, {
      kind: 'confirm',
      purpose: 'money_confirmation',
      question: row.duplicateEntryId === null ? '核对这笔账' : '这笔好像记过了',
      basis: row.duplicateEntryId === null ? 'missing' : 'options',
      actionId: `money-draft:${row.id}`,
      context: { moneyDraftId: row.id },
      options: [
        { id: 'confirm', label: '确认记账' },
        { id: 'reject', label: '不记这笔' },
      ],
    });
    state.moneyDrafts.link(row.id, row.version, ask.id, null);
    changes.afterCommit(() => changed(row.id));
  }

  private recordDirectly(changes: Changes, row: MoneyDraft, fields: PaymentFields, basis: string): void {
    const { state, money, changed } = this.options;
    const merchant = fields.merchant?.trim() ?? '';
    const known = merchant === '' ? null : state.moneyEntries.merchantCategory(merchant);
    const categoryId = known ?? this.guessedCategory(fields);
    const entry = money.record({ ...fields, categoryId, origin: 'ai', review: known === null },
      (action) => changes.afterCommit(action));
    const recorded = { ...fields, categoryId };
    state.moneyDrafts.recordDirectly(row.id, row.version, entry.id, recorded, basis);
    changes.afterCommit(() => changed(row.id));
  }

  /** The model's closest category, when it names one that exists and fits the kind; otherwise none. */
  private guessedCategory(fields: PaymentFields): string | null {
    if (fields.categoryId === null) {
      return null;
    }
    const category = this.options.money.categories().find((item) => item.id === fields.categoryId);
    const kind = fields.kind === 'income' ? 'income' : 'expense';
    return category?.kind === kind ? category.id : null;
  }

  private summary(fields: PaymentFields): string {
    return (
      `${fields.currency} ${(fields.amountCents / 100).toFixed(2)} · ${fields.merchant ?? '未填商户'} · ` +
      fields.occurredAt
    );
  }
  private checkCard(row: MoneyDraft, version: number, askVersion: number): void {
    const ask = row.askId === null ? undefined : this.options.state.asks.get(row.askId);
    if (
      row.version !== version ||
      ask?.version !== askVersion ||
      ask.status !== 'open' ||
      row.status === 'confirmed' ||
      row.status === 'rejected'
    ) {
      throw new StateError('version_conflict', '草案或确认卡已经变动，请先读取最新版。');
    }
  }
}
import { errorCategory, safeLog } from '../util/index.ts';
