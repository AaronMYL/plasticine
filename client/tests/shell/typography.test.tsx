import { act, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { renderApp } from '../helpers.tsx';

const styles = import.meta.glob<string>('../../src/**/*.css', { query: '?raw', import: 'default', eager: true });
let sheet: HTMLStyleElement;

beforeEach(() => {
  sheet = document.createElement('style');
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

describe('rule 92: mixed Chinese and numeral typography', () => {
  it('file timestamps and folder subtitles share mixed style; ledger amounts stay monospace', async () => {
    await renderApp({ setup: (fake) => { fake.control.toolGroups.files.seed('周报.md'); } });
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
