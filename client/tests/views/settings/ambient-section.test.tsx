// 设置 · 通用 · 动态背景（11-13 Aaron）：总开关；开着时形象、速度、透明度、九页开关，点了马上生效、记在这台设备上。

import { fireEvent, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { ambientStore, DEFAULT_AMBIENT } from '../../../src/shell/ambient/settings.ts';
import { renderApp } from '../../helpers.tsx';

async function openGeneral(): Promise<HTMLElement> {
  fireEvent.click(within(screen.getByRole('navigation', { name: '栏目' })).getByRole('button', { name: /^设置/ }));
  const sheet = await screen.findByRole('dialog', { name: '设置' });
  fireEvent.click(within(sheet).getByRole('button', { name: '通用' }));
  return sheet;
}

const saved = (): Record<string, unknown> => JSON.parse(localStorage.getItem('plasticine.ambient') ?? '{}') as
  Record<string, unknown>;

describe('设置 · 通用 · 动态背景', () => {
  beforeEach(() => {
    localStorage.removeItem('plasticine.ambient');
    ambientStore.set(DEFAULT_AMBIENT);
  });

  it('默认开着：形象是下拉（海里 · 鲨鱼），两根滑杆；从下拉里选一个马上记下', async () => {
    await renderApp();
    const sheet = await openGeneral();
    expect(within(sheet).getByRole('switch', { name: '动态背景' })).toHaveProperty('checked', true);
    const figure = within(sheet).getByRole('button', { name: '形象' });
    expect(figure.textContent).toContain('海里 · 鲨鱼');
    fireEvent.click(figure);
    const menu = await screen.findByRole('menu', { name: '形象' });
    expect(within(menu).getAllByRole('menuitemcheckbox')).toHaveLength(11);
    expect(within(menu).getByRole('menuitemcheckbox', { name: '鲨鱼' }).getAttribute('aria-checked')).toBe('true');
    fireEvent.click(within(menu).getByRole('menuitemcheckbox', { name: '猫咪' }));
    expect(saved()['figure']).toBe('cat');
    expect(within(sheet).getByRole('button', { name: '形象' }).textContent).toContain('地上 · 猫咪');
    expect(within(sheet).getByRole('slider', { name: '速度' })).toBeTruthy();
    expect(within(sheet).getByRole('slider', { name: '透明度' })).toBeTruthy();
  });

  it('显示在哪几页是下拉多选：关掉一页只关那一页；速度、透明度拖了就记', async () => {
    await renderApp();
    const sheet = await openGeneral();
    const pagesButton = within(sheet).getByRole('button', { name: '显示在' });
    expect(pagesButton.textContent).toContain('全部页面');
    fireEvent.click(pagesButton);
    const menu = await screen.findByRole('menu', { name: '显示在' });
    expect(within(menu).getAllByRole('menuitemcheckbox')).toHaveLength(9);
    fireEvent.click(within(menu).getByRole('menuitemcheckbox', { name: '笔记' }));
    expect(saved()['pages']).toMatchObject({ notes: false, now: true });
    expect(within(menu).getByRole('menuitemcheckbox', { name: '笔记' }).getAttribute('aria-checked')).toBe('false');
    expect(within(sheet).getByRole('button', { name: '显示在' }).textContent).toContain('8 页');
    fireEvent.change(within(sheet).getByRole('slider', { name: '速度' }), { target: { value: '1.5' } });
    fireEvent.change(within(sheet).getByRole('slider', { name: '透明度' }), { target: { value: '0.3' } });
    expect(saved()).toMatchObject({ speed: 1.5, opacity: 0.3 });
    expect(within(sheet).getByText('30%')).toBeTruthy();
  });

  it('总开关关掉：下面的都收起来，背景这一层也不画', async () => {
    await renderApp();
    expect(document.querySelector('.ambient-layer')).not.toBeNull();
    const sheet = await openGeneral();
    fireEvent.click(within(sheet).getByRole('switch', { name: '动态背景' }));
    expect(saved()['enabled']).toBe(false);
    expect(within(sheet).queryByRole('button', { name: '形象' })).toBeNull();
    expect(document.querySelector('.ambient-layer')).toBeNull();
  });
});
