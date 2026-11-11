// 记账（工具组的浮层，《UI 方案》第 9 节；账本 / 资产 / 统计照旧版三页）：顶上是还没了结的记账操作；「记一笔」的字存在
// inline-drafts（切页、刷新不丢），没了结时不让写新的一笔；账本按天、资产按账户、统计按周 / 月 / 年。金额都是整数分，
// 显示时才换成元。读失败说原因并给「再读一次」。

import { useEffect, useState, type ReactNode } from 'react';
import { useApi } from '../../api/context.tsx';
import { errorText } from '../../api/errors.ts';
import type { MoneyStatsResponse } from '../../api/shared.ts';
import { useLive, useTimeZone } from '../../live.tsx';
import { isOpenOp } from '../../state/action-ops.ts';
import { useClientState } from '../../state/context.tsx';
import { MONEY_ADD_OP_KEY } from '../../state/m5b-action-requests.ts';
import { useStore } from '../../state/use-store.ts';
import { useObjectTarget } from '../../state/use-object-target.ts';
import { PendingOps, useOp } from '../pending/pending-ops.tsx';
import { centsOf, moneyDraftKey } from '../m5b/m5b-actions.ts';
import { LoadNote, shortTime, yuan } from '../m5b/load-note.tsx';
import './tools.css';
import { AddMoneyAccount, MoneyEditor } from './money-editor.tsx';
import { MoneyWeek } from './money-week.tsx';

type Tab = 'ledger' | 'assets' | 'stats';
const TABS: readonly { id: Tab; label: string }[] = [
  { id: 'ledger', label: '账本' },
  { id: 'assets', label: '资产' },
  { id: 'stats', label: '统计' },
];

function shiftMonth(month: string, by: number): string {
  const [year = 1970, index = 1] = month.split('-').map(Number);
  const date = new Date(Date.UTC(year, index - 1 + by, 1));
  return date.toISOString().slice(0, 7);
}

function AddEntry(): ReactNode {
  const { m5b, m5bActions } = useLive();
  const { inlineDrafts } = useClientState();
  const drafts = useStore(inlineDrafts.store);
  const money = useStore(m5b.money.data);
  const op = useOp(MONEY_ADD_OP_KEY);
  const locked = op !== undefined && isOpenOp(op);
  const field = (name: Parameters<typeof moneyDraftKey>[0]): string => drafts.get(moneyDraftKey(name)) ?? '';
  const set = (name: Parameters<typeof moneyDraftKey>[0], text: string): void => {
    inlineDrafts.set(moneyDraftKey(name), text);
  };
  const kind = field('kind') === 'income' ? 'income' : 'expense';
  const amountOk = centsOf(field('amount')) !== null;
  const categories = (money.value?.categories ?? []).filter((category) => category.kind === kind);
  const setKind = (next: 'expense' | 'income'): void => {
    set('kind', next);
    if (!money.value?.categories.some((category) => category.id === field('category') && category.kind === next)) {
      inlineDrafts.clear(moneyDraftKey('category'));
    }
  };
  return (
    <section className="block" aria-label="记一笔">
      <div className="segmented" role="group" aria-label="支出还是收入">
        {(['expense', 'income'] as const).map((value) => (
          <button
            key={value}
            type="button"
            className="segmented-item"
            aria-pressed={kind === value}
            disabled={locked}
            onClick={() => setKind(value)}
          >
            {value === 'expense' ? '支出' : '收入'}
          </button>
        ))}
      </div>
      <div className="tool-form">
        <label className="field field-narrow">
          <span className="field-label">金额（元）</span>
          <input
            className="field-input field-input-mono"
            inputMode="decimal"
            value={field('amount')}
            disabled={locked}
            onChange={(event) => set('amount', event.target.value)}
          />
        </label>
        <label className="field">
          <span className="field-label">分类</span>
          <select
            className="tool-select"
            value={field('category')}
            disabled={locked}
            onChange={(event) => set('category', event.target.value)}
          >
            <option value="">不分类</option>
            {categories.map((category) => (
              <option key={category.id} value={category.id}>
                {category.name}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span className="field-label">商户</span>
          <input
            className="field-input"
            value={field('merchant')}
            disabled={locked}
            onChange={(event) => set('merchant', event.target.value)}
          />
        </label>
        <button
          type="button"
          className="primary-button"
          disabled={locked || !amountOk}
          onClick={() => void m5bActions.recordMoney()}
        >
          记下
        </button>
      </div>
      {field('amount') !== '' && !amountOk ? <p className="tool-sub tool-error">金额写成 28 或 28.50 这样的正数。</p> : null}
    </section>
  );
}

function Ledger({ date, entryId, highlighted }: {
  date: string | null; entryId: string | undefined; highlighted: boolean;
}): ReactNode {
  const { m5b, m5bActions } = useLive();
  const timeZone = useTimeZone();
  const money = useStore(m5b.money.data);
  const value = money.value;
  const [editing, setEditing] = useState<string | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);
  if (value === null) {
    return null;
  }
  const days = date === null ? value.days : value.days.filter((day) => day.date === date);
  const expense = date === null ? value.expenseCents : days.reduce((sum, day) => sum + day.expenseCents, 0);
  const income = date === null ? value.incomeCents : days.reduce((sum, day) => sum + day.incomeCents, 0);
  const balance = date === null ? value.balanceCents : income - expense;
  const review = date === null ? value.review
    : days.flatMap((day) => day.entries).filter((entry) => entry.review).length;
  return (
    <section className="block" aria-label="账本">
      <div className="tool-figures">
        <span className="tool-figure">
          <span className="tool-sub">支出</span>
          <span className="tool-num-strong">{yuan(expense)}</span>
        </span>
        <span className="tool-figure">
          <span className="tool-sub">收入</span>
          <span className="tool-num-strong">{yuan(income)}</span>
        </span>
        <span className="tool-figure">
          <span className="tool-sub">结余</span>
          <span className="tool-num-strong">{yuan(balance)}</span>
        </span>
      </div>
      {date === null ? <MoneyWeek /> : null}
      {review > 0 ? <p className="tool-sub">有 {review} 笔等你看一眼。</p> : null}
      {money.status !== 'ready' || days.length > 0 ? null :
        <p className="block-empty">{date === null ? '这个月还没有记账。' : '这天还没有记账。'}</p>}
      {days.map((day) => (
        <ul key={day.date} className="tool-list" aria-label={day.date} id={`money-day-${day.date}`} tabIndex={-1}
          data-target-highlight={highlighted && entryId === undefined && date === day.date}>
          <li className="tool-row">
            <span className="tool-row-main tool-num">{day.date}</span>
            <span className="tool-row-meta text-meta">支出 {yuan(day.expenseCents)}</span>
          </li>
          {day.entries.map((entry) => (
            <li key={entry.id} id={`money-entry-${entry.id}`} tabIndex={-1}
              data-target-highlight={highlighted && entryId === entry.id}
              className="tool-row" aria-label={entry.merchant ?? entry.categoryName ?? '一笔账'}>
              <span className="tool-row-main">
                <button type="button" className="text-button" onClick={() => setEditing(entry.id)}>
                {entry.merchant ?? entry.categoryName ?? '一笔账'}
                </button>
                {entry.kind === 'refund' ? <span className="tag tag-neutral">退款</span> : null}
                {entry.kind === 'transfer' ? <span className="tag tag-neutral">转账 · 不计收支</span> : null}
                {entry.review ? <span className="tag tag-outline"> 待你看一眼</span> : null}
              </span>
              <span className="tool-row-meta text-meta">{shortTime(entry.occurredAt, timeZone)}</span>
              <span className="tool-num">
                {entry.kind === 'expense' ? '−' : ''}
                {entry.kind === 'income' || entry.kind === 'refund' ? '+' : ''}
                {yuan(entry.cnyCents)}
                {entry.currency === 'CNY' ? '' : ` ${entry.currency}`}
              </span>
              <button type="button" className="text-button text-button-quiet" aria-expanded={removing === entry.id}
                onClick={() => setRemoving(entry.id)}>
                删除
              </button>
              {/* 删除先说后果再删（第 7 批第 12 条：原来点了直接删）。 */}
              {removing !== entry.id ? null : (
                <div className="tool-confirm" role="group" aria-label="确认删除这笔账">
                  <span>删掉这笔账？删了就不再算进收支和资产。</span>
                  <button type="button" className="chip-button" onClick={() => {
                    setRemoving(null);
                    void m5bActions.removeMoney(entry);
                  }}>删除</button>
                  <button type="button" className="text-button text-button-quiet" onClick={() => setRemoving(null)}>
                    先不
                  </button>
                </div>
              )}
              {editing !== entry.id ? null :
                <MoneyEditor entry={entry} ledger={value} onClose={() => setEditing(null)} />}
            </li>
          ))}
        </ul>
      ))}
    </section>
  );
}

function Assets(): ReactNode {
  const { m5b } = useLive();
  const value = useStore(m5b.money.data).value;
  if (value === null) {
    return null;
  }
  return (
    <section className="block" aria-label="资产">
      <AddMoneyAccount />
      <div className="tool-figures">
        <span className="tool-figure">
          <span className="tool-sub">净资产</span>
          <span className="tool-num-strong">{yuan(value.netCents)}</span>
        </span>
        <span className="tool-figure">
          <span className="tool-sub">负债</span>
          <span className="tool-num-strong">{yuan(value.debtsCents)}</span>
        </span>
      </div>
      {value.accounts.length === 0 ? <p className="block-empty">还没有账户。</p> : null}
      <ul className="tool-list">
        {value.accounts.map((account) => (
          <li key={account.id} className="tool-row">
            <span className="tool-row-main">
              {account.name}
              {account.excluded ? <span className="tag tag-neutral"> 不计入</span> : null}
            </span>
            <span className="tool-num">{yuan(account.balanceCents)}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Stats(): ReactNode {
  const api = useApi();
  const { m5b } = useLive();
  const money = useStore(m5b.money.data).value;
  const [range, setRange] = useState<'week' | 'month' | 'year'>('month');
  const [anchor, setAnchor] = useState(() => new Date().toLocaleDateString('en-CA', { timeZone: m5b.timeZone }));
  const [stats, setStats] = useState<{ value: MoneyStatsResponse | null; error: string | null }>({
    value: null,
    error: null,
  });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    api.money
      .stats({ range, anchor, tz: m5b.timeZone }, controller.signal)
      .then((value) => {
        if (!controller.signal.aborted) {
          setStats({ value, error: null });
        }
      })
      .catch((cause: unknown) => {
        if (!controller.signal.aborted) {
          setStats({ value: null, error: errorText(cause) });
        }
      });
    return () => controller.abort();
  }, [api, m5b.timeZone, range, attempt, money, anchor]);
  const move = (by: number) => {
    const date = new Date(`${anchor}T12:00:00Z`);
    if (range === 'week') { date.setUTCDate(date.getUTCDate() + by * 7); }
    else if (range === 'month') { date.setUTCDate(1); date.setUTCMonth(date.getUTCMonth() + by); }
    else { date.setUTCFullYear(date.getUTCFullYear() + by); }
    setAnchor(date.toISOString().slice(0, 10));
  };
  return (
    <section className="block" aria-label="统计">
      <div className="tool-bar"><button className="text-button" type="button" onClick={() => move(-1)}>上一期</button>
        <span className="text-meta">{anchor}</span>
        <button className="text-button" type="button" onClick={() => move(1)}>下一期</button></div>
      <div className="segmented" role="group" aria-label="统计的范围">
        {(['week', 'month', 'year'] as const).map((value) => (
          <button
            key={value}
            type="button"
            className="segmented-item"
            aria-pressed={range === value}
            onClick={() => setRange(value)}
          >
            {{ week: '这周', month: '这个月', year: '今年' }[value]}
          </button>
        ))}
      </div>
      <LoadNote
        resource={{ status: stats.value === null ? 'loading' : 'ready', error: stats.error, value: stats.value }}
        what="统计"
        onRetry={() => setAttempt((n) => n + 1)}
      />
      {stats.value === null ? null : (
        <>
          <p className="tool-row-meta text-meta">
            {stats.value.from} 起 · 支出 {yuan(stats.value.expenseCents)} · 收入 {yuan(stats.value.incomeCents)} ·{' '}
            {stats.value.count} 笔
          </p>
          <ul className="tool-list" aria-label="分类">
            {stats.value.byCategory.map((row) => (
              <li key={row.categoryId} className="tool-row">
                <span className="tool-row-main">{row.name}</span>
                <span className="tool-num">{Math.round(row.share * 100)}%</span>
                <span className="tool-num">{yuan(row.amountCents)}</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

export function MoneyView({ entry, date }: {
  entry?: { id: string; occurredAt: string } | undefined;
  date?: string | undefined;
}): ReactNode {
  const { m5b, m5bActions } = useLive();
  const timeZone = useTimeZone();
  const money = useStore(m5b.money.data);
  const month = useStore(m5b.moneyMonth);
  const [tab, setTab] = useState<Tab>('ledger');
  const [selectedDate, setSelectedDate] = useState<string | null>(date ?? null);
  const entryDate = entry === undefined ? undefined
    : new Date(entry.occurredAt).toLocaleDateString('en-CA', { timeZone });
  const requestedMonth = (date ?? entryDate)?.slice(0, 7);
  useEffect(() => {
    setSelectedDate(date ?? null);
    setTab('ledger');
    if (requestedMonth === undefined || m5b.moneyMonth.get() === requestedMonth) { return; }
    m5b.moneyMonth.set(requestedMonth);
    void m5b.money.reset();
  }, [date, requestedMonth, m5b]);
  const target = entry !== undefined ? `money-entry-${entry.id}`
    : selectedDate === null ? null : `money-day-${selectedDate}`;
  const found = tab === 'ledger' && (money.value?.days.some((day) => entry === undefined
    ? day.date === selectedDate : day.entries.some((item) => item.id === entry.id)) ?? false);
  const highlighted = useObjectTarget(target, found);
  useEffect(() => {
    m5b.money.open();
  }, [m5b.money]);
  const goMonth = (by: number): void => {
    setSelectedDate(null);
    m5b.moneyMonth.set(shiftMonth(month, by));
    void m5b.money.reset();
  };
  return (
    <div className="tool">
      <PendingOps
        label="还没了结的记账操作"
        prefixes={['money:']}
        visible={() => false}
        onRetry={(key) => void m5bActions.retry(key)}
      />
      <AddEntry />
      <div className="tool-bar">
        <button type="button" className="icon-button" aria-label="上个月" data-tip="上个月" onClick={() => goMonth(-1)}>
          ‹
        </button>
        <span className="tool-num">{month}</span>
        <button type="button" className="icon-button" aria-label="下个月" data-tip="下个月" onClick={() => goMonth(1)}>
          ›
        </button>
        <span className="tool-bar-grow" />
        <div className="segmented" role="group" aria-label="账本、资产、统计">
          {TABS.map((item) => (
            <button
              key={item.id}
              type="button"
              className="segmented-item"
              aria-pressed={tab === item.id}
              onClick={() => setTab(item.id)}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>
      <LoadNote resource={money} what="账本" onRetry={() => void m5b.money.reload()} />
      {tab !== 'ledger' || selectedDate === null ? null : <div className="tool-bar">
        <span className="tool-sub">正在看 {selectedDate} 的账目</span>
        <button type="button" className="text-button" onClick={() => setSelectedDate(null)}>查看整月</button>
      </div>}
      {tab === 'ledger' ? <Ledger date={selectedDate} entryId={entry?.id} highlighted={highlighted} /> : null}
      {tab === 'assets' ? <Assets /> : null}
      {tab === 'stats' ? <Stats /> : null}
    </div>
  );
}
