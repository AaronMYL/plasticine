import { act, fireEvent, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { renderApp, settle } from '../helpers.tsx';

// jsdom 不加载 Vite 的 CSS 副作用；用同一批实际样式核对混排字体和数字特性。
const styles = import.meta.glob<string>('../../src/**/*.css', { query: '?raw', import: 'default', eager: true });
let sheet: HTMLStyleElement;

beforeEach(() => {
  sheet = document.createElement('style');
  // jsdom 尚不解析字体的 CSS 变量；只把两种字体替成各自的标准兜底，层叠仍用实际样式。
  sheet.textContent = Object.values(styles).join('\n')
    .replaceAll('var(--sans)', 'sans-serif').replaceAll('var(--mono)', 'monospace');
  document.head.append(sheet);
});

afterEach(() => sheet.remove());

function mixed(element: Element | null): void {
  expect(element).not.toBeNull();
  if (element === null) {
    throw new Error('应该有混排元信息');
  }
  expect(element.classList.contains('text-meta')).toBe(true);
  const style = getComputedStyle(element);
  expect(style.fontFamily).toBe('sans-serif');
  expect(style.fontVariantNumeric).toBe('tabular-nums');
}

function numeric(element: Element): void {
  const style = getComputedStyle(element);
  expect(style.fontFamily).toBe('monospace');
  expect(style.fontVariantNumeric).toBe('tabular-nums');
}

describe('第 92 条 · 中文与数字混排', () => {
  it('约定的范围、时间和页头共用正文字体，数字按等宽排', async () => {
    await renderApp({
      // 第 4 批：约定栏换成「怎么替你做事」，一条约定在引用它的地方单独读。
      hash: '#/memory/agreements/agr_font',
      setup: (fake) => fake.control.agreements.seed({ id: 'agr_font', text: '看流水', scope: '对账', state: 'active' }),
    });
    await settle();
    const entry = await screen.findByRole('listitem', { name: '看流水' });
    mixed(entry.querySelector('.mem-meta'));
    expect(entry.textContent).toContain('对账');
    document.querySelectorAll('.block-meta').forEach(numeric);
    for (const meta of document.querySelectorAll('.page-head-meta, .sidebar-connection')) {
      mixed(meta);
    }
  });

  it('文件时间和文件夹说明共用混排样式；记账的纯金额仍是等宽字体', async () => {
    await renderApp({ setup: (fake) => { fake.control.m5b.files.seed('周报.md'); } });
    const openTool = (name: string): HTMLElement => {
      act(() => { window.location.hash = name === '文件' ? '#/tools/files' : '#/tools/money'; });
      return screen.getByRole('main');
    };
    const files = openTool('文件');
    const row = await within(files).findByRole('listitem', { name: '周报.md' });
    row.querySelectorAll('.tool-row-meta').forEach(mixed);
    files.querySelectorAll('.block-meta').forEach(numeric);
    const money = openTool('记账');
    await within(money).findByText('这个月还没有记账。');
    const amounts = money.querySelectorAll('.tool-num-strong');
    expect(amounts.length).toBeGreaterThan(0);
    amounts.forEach(numeric);
  });
});
