import { useState, type ReactNode } from 'react';
import type { MoneyEntryView, MoneyResponse, AddMoneyAccountRequest } from '../../api/shared.ts';
import { useLive, useTimeZone } from '../../live.tsx';
import { fromTimeInput, timeInput } from '../../primitives/message/states.ts';
import { useClientState } from '../../state/context.tsx';
import { useStore } from '../../state/use-store.ts';
import { isOpenOp } from '../../state/action-ops.ts';
import { moneyEntryOpKey, MONEY_ACCOUNT_OP_KEY } from '../../state/m5b-action-requests.ts';
import { centsOf } from '../m5b/m5b-actions.ts';
import { useOp } from '../pending/pending-ops.tsx';

export function MoneyEditor({ entry, ledger, onClose }: {
  entry: MoneyEntryView; ledger: MoneyResponse; onClose(): void;
}): ReactNode {
  const live = useLive();
  const timeZone = useTimeZone();
  const { editDrafts } = useClientState();
  const key = `money:edit:${entry.id}`;
  const draft = useStore(editDrafts.store).get(key);
  const fields = { amount: (entry.amountCents / 100).toFixed(2), kind: entry.kind, category: entry.categoryId ?? '',
    account: entry.accountId ?? '', toAccount: entry.toAccountId ?? '', merchant: entry.merchant ?? '',
    note: entry.note ?? '', at: timeInput(entry.occurredAt, timeZone), ...draft?.fields };
  const op = useOp(moneyEntryOpKey(entry.id, 'edit'));
  const locked = op !== undefined && isOpenOp(op);
  const conflict = draft !== undefined && draft.baseVersion !== entry.version;
  const change = (name: string, value: string) => editDrafts.set(key, entry.version, { ...fields, [name]: value });
  const categoryKind = fields.kind === 'refund' ? 'expense' : fields.kind;
  const categories = ledger.categories.filter((category) => category.kind === categoryKind);
  const changeKind = (kind: string) => {
    const matching = kind === 'refund' ? 'expense' : kind;
    const category = ledger.categories.find((item) => item.id === fields.category && item.kind === matching);
    editDrafts.set(key, entry.version, { ...fields, kind, category: category?.id ?? '',
      toAccount: kind === 'transfer' ? fields.toAccount : '' });
  };
  const amount = centsOf(fields.amount);
  const at = fromTimeInput(fields.at, timeZone);
  const save = async () => {
    if (amount === null || at === null) { return; }
    if (await live.m5bActions.editMoney(entry.id, { version: draft?.baseVersion ?? entry.version,
      amountCents: amount, kind: fields.kind as MoneyEntryView['kind'], categoryId: fields.category || null,
      accountId: fields.account || null, toAccountId: fields.kind === 'transfer' ? fields.toAccount || null : null,
      merchant: fields.merchant || null, note: fields.note || null, occurredAt: at, review: false })) {
      editDrafts.clear(key); onClose();
    }
  };
  return <div className="inline-edit" aria-label="编辑这笔账">
    <label className="field">金额（{entry.currency}）<input className="field-input" inputMode="decimal"
      value={fields.amount} disabled={locked} onChange={(event) => change('amount', event.target.value)} /></label>
    <label className="field">类型<select className="tool-select" value={fields.kind} disabled={locked}
      onChange={(event) => changeKind(event.target.value)}>
      <option value="expense">支出</option><option value="income">收入</option>
      <option value="transfer">转账</option><option value="refund">退款</option>
    </select></label>
    <label className="field">分类<select className="tool-select" value={fields.category}
      disabled={locked || fields.kind === 'transfer'}
      onChange={(event) => change('category', event.target.value)}><option value="">不分类</option>
      {categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
    </select></label>
    {(['account', ...(fields.kind === 'transfer' ? ['toAccount'] : [])] as string[]).map((name) =>
      <label className="field" key={name}>{name === 'account' ? '账户' : '转入账户'}
        <select className="tool-select" value={fields[name as 'account' | 'toAccount']} disabled={locked}
          onChange={(event) => change(name, event.target.value)}><option value="">未指定</option>
          {ledger.accounts.map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}
        </select></label>)}
    {([['at', '时间'], ['merchant', '商户'], ['note', '备注']] as const).map(([name, label]) =>
      <label className="field" key={name}>{label}<input className="field-input" value={fields[name]}
        type={name === 'at' ? 'datetime-local' : 'text'} disabled={locked}
        onChange={(event) => change(name, event.target.value)} /></label>)}
    {conflict ? <p role="alert">这笔账已在别处修改，草稿仍在。<button type="button" className="text-button"
      onClick={() => editDrafts.rebase(key, entry.version)}>已核对新版，保留我的修改</button></p> : null}
    <div className="ask-options"><button type="button" className="primary-button"
      disabled={locked || conflict || amount === null || at === null} onClick={() => void save()}>保存这笔账</button>
      <button type="button" className="text-button" disabled={locked} onClick={onClose}>取消</button></div>
  </div>;
}

export function AddMoneyAccount(): ReactNode {
  const { m5bActions } = useLive();
  const { inlineDrafts } = useClientState();
  const drafts = useStore(inlineDrafts.store);
  const op = useOp(MONEY_ACCOUNT_OP_KEY);
  const locked = op !== undefined && isOpenOp(op);
  const [open, setOpen] = useState(false);
  const field = (name: string) => drafts.get(`money:account:${name}`) ?? '';
  const set = (name: string, value: string) => inlineDrafts.set(`money:account:${name}`, value);
  const opening = field('opening') || '0';
  const valid = /^-?\d{1,9}(\.\d{1,2})?$/.test(opening);
  if (!open) { return <button type="button" className="chip-button" onClick={() => setOpen(true)}>加一个账户</button>; }
  return <section className="inline-edit" aria-label="加一个账户">
    <label className="field">账户名字<input className="field-input" value={field('name')} disabled={locked}
      onChange={(event) => set('name', event.target.value)} /></label>
    <label className="field">账户类型<select className="tool-select" value={field('type') || 'debit'} disabled={locked}
      onChange={(event) => set('type', event.target.value)}>
      {Object.entries({ debit: '储蓄卡', credit: '信用卡', wallet: '电子钱包', cash: '现金', other: '其他' })
        .map(([value, label]) => <option key={value} value={value}>{label}</option>)}
    </select></label>
    <label className="field">期初余额（元）<input className="field-input" inputMode="decimal" value={opening}
      disabled={locked} onChange={(event) => set('opening', event.target.value)} /></label>
    <button type="button" className="primary-button" disabled={locked || !valid || field('name').trim() === ''}
      onClick={() => void (async () => {
        const saved = await m5bActions.addMoneyAccount({ name: field('name').trim(),
          type: (field('type') || 'debit') as AddMoneyAccountRequest['type'],
          openingCents: Math.round(Number(opening) * 100) });
        if (saved) { for (const name of ['name', 'type', 'opening']) { inlineDrafts.clear(`money:account:${name}`); }
          setOpen(false); }
      })()}>保存账户</button>
    <button type="button" className="text-button" disabled={locked} onClick={() => setOpen(false)}>取消</button>
  </section>;
}
