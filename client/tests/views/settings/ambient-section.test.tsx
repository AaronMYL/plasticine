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

describe('Settings - General - Ambient background', () => {
  beforeEach(() => {
    localStorage.removeItem('plasticine.ambient');
    ambientStore.set(DEFAULT_AMBIENT);
  });

  it('enabled by default with preview, creature dropdown, and speed/opacity sliders saving live', async () => {
    await renderApp();
    const sheet = await openGeneral();
    expect(within(sheet).getByRole('switch', { name: '动态背景' })).toHaveProperty('checked', true);
    expect(sheet.querySelector('.ambient-preview')).not.toBeNull();
    const figure = within(sheet).getByRole('button', { name: '形象' });
    expect(figure.textContent).toContain('海里 · 鲨鱼');
    fireEvent.click(figure);
    const menu = await screen.findByRole('menu', { name: '形象' });
    expect(within(menu).getAllByRole('menuitemcheckbox')).toHaveLength(11);
    expect(within(menu).getByRole('menuitemcheckbox', { name: '鲨鱼' }).getAttribute('aria-checked')).toBe('true');
    fireEvent.click(within(menu).getByRole('menuitemcheckbox', { name: '猫咪' }));
    expect(saved()['figure']).toBe('cat');
    expect(within(sheet).getByRole('button', { name: '形象' }).textContent).toContain('地上 · 猫咪');
    const speed = within(sheet).getByRole<HTMLInputElement>('slider', { name: '速度' });
    expect([speed.min, speed.max, speed.value]).toEqual(['0.25', '2', '1']);
    expect(speed.getAttribute('aria-valuetext')).toBe('1×');
    const opacity = within(sheet).getByRole('slider', { name: '透明度' });
    expect([opacity.getAttribute('min'), opacity.getAttribute('max')]).toEqual(['0.1', '1']);
    expect(opacity.getAttribute('aria-valuetext')).toBe('60%');
  });

  it('visible-pages multi-select toggles per page and slider drags persist immediately', async () => {
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
    fireEvent.keyDown(menu, { key: 'Escape' });
    fireEvent.change(within(sheet).getByRole('slider', { name: '速度' }), { target: { value: '1.5' } });
    fireEvent.change(within(sheet).getByRole('slider', { name: '透明度' }), { target: { value: '0.35' } });
    expect(saved()).toMatchObject({ speed: 1.5, opacity: 0.35 });
    expect(within(sheet).getByRole('slider', { name: '透明度' }).getAttribute('aria-valuetext')).toBe('35%');
    expect(within(sheet).getByText('35%')).toBeTruthy();
    expect(within(sheet).getByText('1.5×')).toBeTruthy();
  });

  it('master toggle off hides sub-controls and unmounts background layer', async () => {
    await renderApp();
    expect(document.querySelector('.ambient-layer')).not.toBeNull();
    const sheet = await openGeneral();
    fireEvent.click(within(sheet).getByRole('switch', { name: '动态背景' }));
    expect(saved()['enabled']).toBe(false);
    expect(within(sheet).queryByRole('button', { name: '形象' })).toBeNull();
    expect(sheet.querySelector('.ambient-preview')).toBeNull();
    expect(document.querySelector('.ambient-layer')).toBeNull();
  });
});
