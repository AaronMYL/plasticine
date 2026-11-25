import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../../src/api/errors.ts';
import type { FakeApi } from '../../../src/api/fake/index.ts';
import { memoryStorage, renderApp, settle } from '../../helpers.tsx';
import toolsCss from '../../../src/views/tools/tools.css?raw';

afterEach(() => vi.useRealTimers());

function openTool(name: string): HTMLElement {
  fireEvent.click(within(screen.getByRole('navigation', { name: '栏目' })).getByRole('button', { name: '网页' }));
  fireEvent.click(within(screen.getByRole('main')).getByRole('button', { name: new RegExp(`^${name}`) }));
  return screen.getByRole('main');
}

function unavailable(): ApiError {
  return new ApiError({ kind: 'failed', code: 'network', message: '连不上服务器。', next: '检查网络后再试。' });
}

describe('Ledger', () => {
  it('switching from expense to income clears expense category so submit does not send stale value', async () => {
    const app = await renderApp();
    await settle();
    const sheet = openTool('记账');
    await within(sheet).findByText('这个月还没有记账。');
    fireEvent.change(within(sheet).getByLabelText('分类'), { target: { value: 'food' } });
    fireEvent.click(within(sheet).getByRole('button', { name: '收入' }));
    expect(within(sheet).getByLabelText('分类')).toHaveProperty('value', '');
    fireEvent.change(within(sheet).getByLabelText('金额（元）'), { target: { value: '20' } });
    const record = vi.spyOn(app.api.money, 'record');
    fireEvent.click(within(sheet).getByRole('button', { name: '记下' }));
    await waitFor(() => expect(record).toHaveBeenCalled());
    expect(record.mock.calls[0]?.[0]).toMatchObject({ kind: 'income', amountCents: 2000 });
    expect(record.mock.calls[0]?.[0].categoryId).toBeUndefined();
  });

  it('displays income +, refund + with tag, expense -, and excludes transfers from totals', async () => {
    await renderApp({ setup: (fake) => {
      for (const [kind, merchant] of [['income', '工资'], ['refund', '退货'], ['expense', '面馆'],
        ['transfer', '挪钱']] as const) {
        fake.control.toolGroups.money.seed({ id: kind, kind, merchant, amountCents: 1000,
          accountId: 'from', toAccountId: 'to', occurredAt: new Date().toISOString() });
      }
    } });
    await settle();
    const sheet = openTool('记账');
    const text = async (name: string): Promise<string | null> =>
      (await within(sheet).findByRole('listitem', { name })).textContent;
    expect(await text('工资')).toContain('+¥10.00');
    expect(await text('退货')).toContain('+¥10.00');
    expect(await text('退货')).toContain('退款');
    expect(await text('面馆')).toContain('−¥10.00');
    expect(await text('挪钱')).toContain('转账');
    expect(await text('挪钱')).toContain('不计收支');
    expect(await text('挪钱')).not.toContain('−¥10.00');
  });

  it('deleting entry explains consequences, keeps unchanged on Cancel, and deletes on Delete', async () => {
    const app = await renderApp({ setup: (fake) => {
      fake.control.toolGroups.money.seed({ id: 'noodles', kind: 'expense', merchant: '面馆', amountCents: 1000,
        occurredAt: new Date().toISOString() });
    } });
    await settle();
    const sheet = openTool('记账');
    const row = await within(sheet).findByRole('listitem', { name: '面馆' });
    const remove = vi.spyOn(app.api.money, 'remove');
    fireEvent.click(within(row).getByRole('button', { name: '删除' }));
    const confirm = within(row).getByRole('group', { name: '确认删除这笔账' });
    expect(confirm.textContent).toContain('不再算进收支');
    fireEvent.click(within(confirm).getByRole('button', { name: '先不' }));
    expect(within(row).queryByRole('group', { name: '确认删除这笔账' })).toBeNull();
    expect(remove).not.toHaveBeenCalled();
    fireEvent.click(within(row).getByRole('button', { name: '删除' }));
    fireEvent.click(within(within(row).getByRole('group', { name: '确认删除这笔账' }))
      .getByRole('button', { name: '删除' }));
    await waitFor(() => expect(remove).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(within(sheet).queryByRole('listitem', { name: '面馆' })).toBeNull());
  });

  it('adding entry on stats view refreshes current range and also refreshes on remote ledger events', async () => {
    const app = await renderApp();
    await settle();
    const sheet = openTool('记账');
    await within(sheet).findByText('这个月还没有记账。');
    fireEvent.click(within(sheet).getByRole('button', { name: '统计' }));
    const stats = within(sheet).getByRole('region', { name: '统计' });
    fireEvent.click(within(stats).getByRole('button', { name: '这周' }));
    await waitFor(() => expect(stats.textContent).toContain('0 笔'));
    fireEvent.change(within(sheet).getByLabelText('金额（元）'), { target: { value: '20' } });
    fireEvent.click(within(sheet).getByRole('button', { name: '记下' }));
    await waitFor(() => expect(stats.textContent).toContain('支出 ¥20.00'));
    await act(async () => {
      await app.api.money.record({ requestId: 'elsewhere', kind: 'income', amountCents: 3000 });
    });
    await waitFor(() => expect(stats.textContent).toContain('收入 ¥30.00'));
    expect(stats.textContent).toContain('2 笔');
    expect(within(stats).getByRole('button', { name: '这周' }).getAttribute('aria-pressed')).toBe('true');
  });

  it.each([
    ['2026-10-31T15:59:00.000Z', '2026-10'],
    ['2026-10-31T16:56:00.000Z', '2026-11'],
  ])('记一笔回执丢了：表单锁住、页顶列出待核实；「再核实」发同一个请求体，账本里只有一笔（上海，%s）',
    async (instant, month) => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(instant));
    const app = await renderApp({ now: () => new Date(), setup(fake) {
      const settings = fake.api.today.settings.bind(fake.api.today);
      vi.spyOn(fake.api.today, 'settings').mockImplementation(async () => (
        { ...await settings(), timeZone: 'Asia/Shanghai' }
      ));
    } });
    await settle();
    const sheet = openTool('记账');
    await within(sheet).findByText(month);
    await within(sheet).findByText('这个月还没有记账。');
    const record = vi.spyOn(app.api.money, 'record');
    fireEvent.change(within(sheet).getByLabelText('金额（元）'), { target: { value: '28.5' } });
    fireEvent.change(within(sheet).getByLabelText('商户'), { target: { value: '楼下面馆' } });
    app.control.faults.next('money', { kind: 'uncertain', landed: true });
    fireEvent.click(within(sheet).getByRole('button', { name: '记下' }));
    const pending = await within(sheet).findByRole('region', { name: '还没了结的记账操作' });
    expect(pending.textContent).toContain('结果待核实');
    expect(within(sheet).getByLabelText('金额（元）')).toHaveProperty('disabled', true);
    fireEvent.click(within(pending).getByRole('button', { name: '再核实' }));
    await waitFor(() => expect(within(sheet).queryByRole('region', { name: '还没了结的记账操作' })).toBeNull());
    expect(record).toHaveBeenCalledTimes(2);
    expect(record.mock.calls[1]).toEqual(record.mock.calls[0]);
    expect(record.mock.calls[0]?.[0].amountCents).toBe(2850);
    await waitFor(() => expect(within(sheet).getAllByRole('listitem', { name: '楼下面馆' })).toHaveLength(1));
    expect(within(sheet).getByLabelText('金额（元）')).toHaveProperty('value', '');
    const ledger = await app.api.money.month({ month, tz: 'Asia/Shanghai' });
    const entries = ledger.days.flatMap((day) => day.entries);
    expect(entries).toHaveLength(1);
    expect(entries[0]?.occurredAt).toBe(instant);
  });

  it('reloading tab mid-entry preserves amount and merchant draft', async () => {
    const storage = memoryStorage();
    const first = await renderApp({ storage });
    await settle();
    const sheet = openTool('记账');
    fireEvent.change(within(sheet).getByLabelText('金额（元）'), { target: { value: '12' } });
    fireEvent.change(within(sheet).getByLabelText('商户'), { target: { value: '菜场' } });
    first.view.unmount();
    await renderApp({ storage });
    await settle();
    const again = openTool('记账');
    expect(within(again).getByLabelText('金额（元）')).toHaveProperty('value', '12');
    expect(within(again).getByLabelText('商户')).toHaveProperty('value', '菜场');
  });

  it('ledger fetch failure shows reason and Reload instead of empty No entries state', async () => {
    const app = await renderApp({
      setup: (fake: FakeApi) => {
        vi.spyOn(fake.api.money, 'month').mockRejectedValueOnce(unavailable());
      },
    });
    await settle();
    const sheet = openTool('记账');
    const alert = await within(sheet).findByRole('alert');
    expect(alert.textContent).toContain('再读一次');
    expect(within(sheet).queryByText('这个月还没有记账。')).toBeNull();
    fireEvent.click(within(alert).getByRole('button', { name: '再读一次' }));
    await within(sheet).findByText('这个月还没有记账。');
    expect(app.api.money.month).toHaveBeenCalledTimes(2);
  });
});

describe('Files', () => {
  it('delete requires typing current name, moves to trash, and trash can restore', async () => {
    await renderApp({ setup: (fake) => void fake.control.toolGroups.files.seed('周报.md') });
    await settle();
    const sheet = openTool('文件');
    const files = (): HTMLElement => within(sheet).getByRole('list', { name: '文件' });
    const row = await within(sheet).findByRole('listitem', { name: '周报.md' });
    fireEvent.click(within(row).getByRole('button', { name: '删除' }));
    const confirm = within(row).getByRole('group', { name: '删除「周报.md」' });
    const go = within(confirm).getByRole('button', { name: '删除（进回收）' });
    expect(go).toHaveProperty('disabled', true);
    fireEvent.change(within(confirm).getByLabelText('打一遍「周报.md」确认'), { target: { value: '周报.md' } });
    fireEvent.click(go);
    await waitFor(() => expect(within(files()).queryByRole('listitem', { name: '周报.md' })).toBeNull());
    const trash = within(sheet).getByRole('region', { name: '回收' });
    await waitFor(() => expect(trash.textContent).toContain('周报.md'));
    fireEvent.click(within(trash).getByRole('button', { name: '还原' }));
    await within(files()).findByRole('listitem', { name: '周报.md' });
  });

  it('file and trash rows align name left and group type, time, and rename/delete on the right', async () => {
    await renderApp({ setup: (fake) => void fake.control.toolGroups.files.seed('周报.md') });
    await settle();
    const sheet = openTool('文件');
    const row = await within(sheet).findByRole('listitem', { name: '周报.md' });
    expect(row.classList.contains('file-row')).toBe(true);
    const side = row.querySelector('.file-row-side');
    expect(side).not.toBeNull();
    expect(side?.querySelectorAll('.tool-row-meta')).toHaveLength(2);
    expect(side?.contains(within(row).getByRole('button', { name: '改名' }))).toBe(true);
    expect(side?.contains(within(row).getByRole('button', { name: '删除' }))).toBe(true);
    expect(side?.contains(within(row).getByText('周报.md'))).toBe(false);
    const sheetCss = new CSSStyleSheet();
    sheetCss.replaceSync(toolsCss);
    const rules = [...sheetCss.cssRules].filter((rule): rule is CSSStyleRule => rule instanceof CSSStyleRule);
    expect(rules.find((rule) => rule.selectorText === '.file-row-side')?.style.marginLeft).toBe('auto');
    expect(rules.find((rule) => rule.selectorText === '.file-row > .tool-row-main')?.style.flex).toBe('1 1 auto');
  });
});

function openToolSwitches(): HTMLElement {
  fireEvent.click(within(screen.getByRole('navigation', { name: '栏目' })).getByRole('button', { name: /^设置/ }));
  const sheet = screen.getByRole('dialog', { name: '设置' });
  fireEvent.click(within(sheet).getByRole('button', { name: 'AI' }));
  return within(sheet).getByRole('region', { name: '工具和技能' });
}

describe('Tool toggles', () => {
  it('toggling a tool group confirms via self session and updates group state on response', async () => {
    const app = await renderApp();
    const [group] = (await app.api.toolGroups.list()).groups;
    if (group === undefined) {
      throw new Error('没有工具组');
    }
    const send = vi.spyOn(app.api.signed, 'send');
    const sheet = openToolSwitches();
    const row = await within(sheet).findByRole('listitem', { name: group.label });
    fireEvent.click(within(row).getByRole('switch', { name: `${group.label}：${group.enabled ? '开着' : '关着'}` }));
    await waitFor(() => expect(within(row).getByRole('switch', {
      name: `${group.label}：${group.enabled ? '关着' : '开着'}` })).toBeTruthy());
    expect(send).toHaveBeenCalledTimes(1);
    const after = (await app.api.toolGroups.list()).groups.find((item) => item.id === group.id);
    expect(after?.enabled).toBe(!group.enabled);
  });
});

describe('Ledger - Weekly screenshot summary', () => {
  it('shows recorded, pending, and original image counts; clearing originals confirms and zeroes', async () => {
    const app = await renderApp({ setup: (fake) => fake.control.moneyDrafts.seedWeek(3, 1) });
    await settle();
    const sheet = openTool('记账');
    const week = await within(sheet).findByRole('group', { name: '截图记账 · 这周' });
    expect(week.textContent).toContain('截图记了 3 笔');
    expect(week.textContent).toContain('1 笔待看');
    expect(week.textContent).toContain('原图 3 张');
    const purge = vi.spyOn(app.api.moneyDrafts, 'purgeOriginals');
    fireEvent.click(within(week).getByRole('button', { name: '清掉原图' }));
    expect(purge).not.toHaveBeenCalled();
    expect(within(week).getByText('删除这 3 张已记账截图的原图？账目不动，原图删了找不回。')).toBeTruthy();
    fireEvent.click(within(week).getByRole('button', { name: '删除原图' }));
    await waitFor(() => expect(purge).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(week.textContent).not.toContain('原图 3 张'));
    expect(within(week).queryByRole('button', { name: '清掉原图' })).toBeNull();
  });

  it('hides summary row when no screenshot entries exist this week', async () => {
    await renderApp();
    await settle();
    const sheet = openTool('记账');
    await within(sheet).findByText('这个月还没有记账。');
    expect(within(sheet).queryByRole('group', { name: '截图记账 · 这周' })).toBeNull();
  });
});
