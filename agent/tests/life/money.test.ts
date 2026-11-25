import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';
import { LifeError, MoneyDesk, type EntryDraft } from '../../src/life/index.ts';
import { openTestState, type TestState } from '../state/helpers.ts';

let t: TestState;
let desk: MoneyDesk;
const NOW = new Date('2026-10-27T08:00:00.000Z');

beforeEach(async () => {
  t = await openTestState();
  desk = new MoneyDesk({ state: t.state, now: () => NOW });
});

afterEach(async () => {
  await t.cleanup();
});

/** A manual entry with only the fields a test is about. */
function draft(fields: Partial<EntryDraft> & Pick<EntryDraft, 'amountCents'>): EntryDraft {
  return { kind: 'expense', origin: 'manual', ...fields };
}

function throwsLife(work: () => unknown, code: LifeError['code'], field?: string): void {
  assert.throws(work, (error: unknown) => {
    assert.ok(error instanceof LifeError, String(error));
    assert.equal(error.code, code);
    if (field !== undefined) {
      assert.equal(error.field, field);
    }
    return true;
  });
}

test('categories seed legacy defaults on first read without recreating later', () => {
  const first = desk.categories();
  assert.equal(first.find((category) => category.id === 'food')?.name, '餐饮');
  assert.equal(first.filter((category) => category.kind === 'income').length, 4);
  assert.equal(desk.categories().length, first.length);
});

test('fees count as expense across ledgers matching net balances; transfer principal excluded', () => {
  const from = desk.addAccount({ name: '钱包', type: 'wallet', openingCents: 100_000 });
  const to = desk.addAccount({ name: '储蓄', type: 'debit', openingCents: 0 });
  desk.record(draft({ kind: 'expense', amountCents: 1_000, feeCents: 50, accountId: from.id, categoryId: 'food' }));
  desk.record(draft({ kind: 'income', amountCents: 5_000, feeCents: 20, accountId: from.id, categoryId: 'salary' }));
  desk.record(draft({ kind: 'refund', amountCents: 200, feeCents: 5, accountId: from.id, categoryId: 'food' }));
  desk.record(draft({ kind: 'transfer', amountCents: 1_000, feeCents: 30, accountId: from.id, toAccountId: to.id }));
  const month = desk.month('2026-10', 'UTC');
  assert.equal(month.expenseCents, 905);
  assert.equal(month.days[0]?.expenseCents, 905);
  assert.equal(month.incomeCents, 5_000);
  assert.equal(month.balanceCents, 4_095);
  assert.equal(desk.assets().netCents - 100_000, month.balanceCents);
  for (const range of ['week', 'month', 'year'] as const) {
    const stats = desk.stats(range, '2026-10-27', 'UTC');
    assert.equal(stats.expenseCents, month.expenseCents);
    assert.equal(stats.feeCents, 105);
    assert.equal(stats.byCategory.find((item) => item.name === '手续费')?.amountCents, 105);
  }
});

test('rejects income/expense category mismatch including on edit; refund may use expense category', () => {
  throwsLife(() => desk.record(draft({ kind: 'income', amountCents: 100, categoryId: 'food' })),
    'invalid_input', 'categoryId');
  throwsLife(() => desk.record(draft({ kind: 'expense', amountCents: 100, categoryId: 'salary' })),
    'invalid_input', 'categoryId');
  const original = desk.record(draft({ amountCents: 100, categoryId: 'food' }));
  throwsLife(() => desk.edit(original.id, original.version, { kind: 'income' }), 'invalid_input', 'categoryId');
  assert.equal(t.state.moneyEntries.get(original.id)?.kind, 'expense');
  assert.equal(desk.record(draft({ kind: 'refund', amountCents: 100, categoryId: 'food' })).categoryId, 'food');
});

test('CNY stores verbatim; foreign currency converts via rate to CNY cents or uses raw if omitted', () => {
  const cny = desk.record({ kind: 'expense', amountCents: 2_850, categoryId: 'food', origin: 'manual' });
  assert.equal(cny.cnyCents, 2_850);
  assert.equal(cny.occurredAt, NOW.toISOString());
  const thb = desk.record({ kind: 'expense', amountCents: 10_000, currency: 'thb', rate: 0.2, origin: 'manual' });
  assert.equal(thb.currency, 'THB');
  assert.equal(thb.cnyCents, 2_000);
  const noRate = desk.record({ kind: 'expense', amountCents: 500, currency: 'USD', origin: 'manual' });
  assert.equal(noRate.cnyCents, 500);
  throwsLife(() => desk.record(draft({ amountCents: 1, currency: 'USD', rate: -1 })), 'invalid_input', 'rate');
});

test('transfer requires two distinct active accounts; rejects unknown categories or accounts', () => {
  const wallet = desk.addAccount({ name: '微信', type: 'wallet', openingCents: 0 });
  const card = desk.addAccount({ name: '招行', type: 'debit', openingCents: 100_00 });
  const half = draft({ kind: 'transfer', amountCents: 100, accountId: wallet.id });
  throwsLife(() => desk.record(half), 'invalid_input', 'toAccountId');
  throwsLife(
    () => desk.record({ ...half, toAccountId: wallet.id }),
    'invalid_input',
  );
  throwsLife(() => desk.record(draft({ amountCents: 100, categoryId: 'nope' })), 'invalid_input', 'categoryId');
  throwsLife(() => desk.record(draft({ amountCents: 100, accountId: 'nope' })), 'invalid_input', 'accountId');
  const both = { kind: 'transfer' as const, accountId: card.id, toAccountId: wallet.id };
  const transfer = desk.record(draft({ ...both, amountCents: 5_000 }));
  assert.equal(transfer.toAccountId, wallet.id);
});

test('ledger groups days in user timezone: late UTC previous day lands on Shanghai current day', () => {
  desk.record({ kind: 'expense', amountCents: 1_000, occurredAt: '2026-10-26T17:30:00.000Z', origin: 'manual' });
  desk.record({ kind: 'income', amountCents: 50_000, occurredAt: '2026-10-27T02:00:00.000Z', origin: 'manual' });
  desk.record({ kind: 'refund', amountCents: 200, occurredAt: '2026-10-27T03:00:00.000Z', origin: 'manual' });
  const month = desk.month('2026-10', 'Asia/Shanghai');
  assert.deepEqual(month.days.map((day) => day.date), ['2026-10-27']);
  assert.equal(month.expenseCents, 800);
  assert.equal(month.incomeCents, 50_000);
  assert.equal(month.balanceCents, 49_200);
  const utc = desk.month('2026-10', 'UTC');
  assert.deepEqual(utc.days.map((day) => day.date), ['2026-10-27', '2026-10-26']);
  throwsLife(() => desk.month('2026-13', 'UTC'), 'invalid_input', 'month');
});

test('omitted edit fields stay unchanged; delete soft-marks, hides from ledger, rejects later edits', () => {
  const entry = desk.record({ kind: 'expense', amountCents: 1_000, merchant: '面馆', origin: 'manual' });
  const edited = desk.edit(entry.id, entry.version, { amountCents: 1_200 });
  assert.equal(edited.merchant, '面馆');
  assert.equal(edited.cnyCents, 1_200);
  const removed = desk.remove(edited.id, edited.version);
  assert.notEqual(removed.deletedAt, null);
  assert.equal(desk.month('2026-10', 'UTC').days.length, 0);
  throwsLife(() => desk.edit(entry.id, removed.version, { amountCents: 1 }), 'not_found');
});

test('money stats start weeks on Monday; category breakdown counts expenses only', () => {
  desk.record(draft({ amountCents: 3_000, categoryId: 'food', occurredAt: '2026-10-26T04:00:00Z' }));
  desk.record(draft({ amountCents: 1_000, categoryId: 'traffic', occurredAt: '2026-10-27T04:00:00Z' }));
  desk.record({ kind: 'expense', amountCents: 9_999, occurredAt: '2026-10-25T04:00:00Z', origin: 'manual' });
  const week = desk.stats('week', '2026-10-28', 'Asia/Shanghai');
  assert.equal(week.from, '2026-10-26');
  assert.equal(week.to, '2026-11-02');
  assert.equal(week.expenseCents, 4_000);
  assert.deepEqual(week.byCategory.map((row) => [row.name, row.share]), [['餐饮', 0.75], ['交通', 0.25]]);
});

test('net worth = opening + income - expense - fee +/- transfers; excluded accounts omitted', () => {
  const card = desk.addAccount({ name: '招行', type: 'debit', openingCents: 100_000 });
  const credit = desk.addAccount({ name: '信用卡', type: 'credit', openingCents: -20_000 });
  const hidden = desk.addAccount({ name: '公司卡', type: 'other', openingCents: 999_999, excluded: true });
  desk.record(draft({ amountCents: 10_000, accountId: card.id, feeCents: 100 }));
  desk.record(draft({ kind: 'transfer', amountCents: 20_000, accountId: card.id, toAccountId: credit.id }));
  const assets = desk.assets();
  const balance = (id: string) => assets.accounts.find((row) => row.account.id === id)?.balanceCents;
  assert.equal(balance(card.id), 100_000 - 10_100 - 20_000);
  assert.equal(balance(credit.id), 0);
  assert.equal(balance(hidden.id), 999_999);
  assert.equal(assets.assetsCents, 69_900);
  assert.equal(assets.debtsCents, 0);
});
