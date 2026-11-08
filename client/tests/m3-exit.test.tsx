// M3 的退出条件在客户端这边的样子（《实施方案》第 9 节；2026-11-03 旧记忆条目的界面去掉后，落在约定上）：
// 改一条待议约定：改完列表里是新的，服务端存下的也是新的；另一台设备改了，这边收到 agreement_changed 也换上新的。
// （≠ 标记和判断 2026-11-05 删了。）

import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { FakeApi } from '../src/api/fake/index.ts';
import { renderApp, settle } from './helpers.tsx';

const OLD = '对账先看流水，不看账单上的汇总数。';
const NEW = '对账先看流水，汇总晚两天才更新时再对一次。';

function main(): HTMLElement {
  return screen.getByRole('main');
}

function seed(fake: FakeApi): void {
  fake.control.agreements.seed({ id: 'agr_ledger', text: OLD, scope: '对账', state: 'under_review' });
}

// 第 4 批：约定栏换成「怎么替你做事」；一条约定在引用它的地方（#/memory/agreements/<id>）单独读，改、≠ 照旧。
function entryRow(text: string): HTMLElement {
  const column = within(main()).getByRole('region', { name: '引用的条目' });
  return within(column).getByRole('listitem', { name: text });
}

describe('M3 退出条件', () => {
  it('改一条待议约定：保存后列表里是新的，服务端存下的也是新的', async () => {
    const app = await renderApp({ hash: '#/memory/agreements/agr_ledger', setup: seed });
    await settle();
    fireEvent.click(within(entryRow(OLD)).getByRole('button', { name: /的更多操作$/ }));
    fireEvent.click(screen.getByRole('menuitem', { name: '修改' }));
    const editor = within(entryRow(OLD)).getByRole('group', { name: '改约定' });
    fireEvent.change(within(editor).getByLabelText('正文', { selector: 'textarea' }), { target: { value: NEW } });
    const save = within(editor).getByRole('button', { name: '保存' });
    await waitFor(() => expect(save.hasAttribute('disabled')).toBe(false));
    fireEvent.click(save);
    await waitFor(() => expect(entryRow(NEW)).toBeTruthy());
    expect(within(main()).queryByRole('listitem', { name: OLD })).toBeNull();
    expect((await app.api.agreements.get('agr_ledger')).agreement.text).toBe(NEW);
    expect(app.state.editDrafts.hasAny()).toBe(false);
  });

  it('另一台设备改了这条约定：收到 agreement_changed，列表就地换成新的', async () => {
    const app = await renderApp({ hash: '#/memory/agreements/agr_ledger', setup: seed });
    await settle();
    act(() => {
      app.control.agreements.changeElsewhere('agr_ledger', { text: NEW });
    });
    await waitFor(() => expect(entryRow(NEW)).toBeTruthy());
  });

});
