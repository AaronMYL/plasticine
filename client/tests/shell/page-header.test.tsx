import { screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import baseCss from '../../src/shell/base.css?raw';
import { renderApp } from '../helpers.tsx';

let styles: HTMLStyleElement | undefined;
afterEach(() => styles?.remove());

function applyStyles(width: number): void {
  const sheet = new CSSStyleSheet();
  sheet.replaceSync(baseCss);
  const collect = (rules: CSSRuleList): string[] => [...rules].flatMap((rule) => {
    if (rule instanceof CSSMediaRule) {
      const max = /max-width:\s*(\d+)px/.exec(rule.conditionText);
      return max !== null && width <= Number(max[1]) ? collect(rule.cssRules) : [];
    }
    return [rule.cssText];
  });
  styles = document.createElement('style');
  styles.textContent = collect(sheet.cssRules).join('\n');
  document.head.append(styles);
}

describe('narrow header layout', () => {
  it.each([
    ['#/notes', ['查找内容', '新建']],
    ['#/feed', ['刷新全部来源', '管理来源']],
  ] as const)('390 宽 %s：标题一行，右边是 %j', async (hash, tools) => {
    applyStyles(390);
    await renderApp({ width: 390, hash });
    const main = screen.getByRole('main');
    const header = within(main).getByRole('heading', { level: 1 }).closest('header');
    expect(header).not.toBeNull();
    expect(header?.querySelector('.page-head-controls')).toBeNull();
    const area = header?.querySelector('.page-head-tools');
    expect(area).toBeTruthy();
    expect(within(area as HTMLElement).getAllByRole('button').map((button) => button.getAttribute('aria-label')))
      .toEqual(tools);
    expect(within(header!).queryByRole('button', { name: /站内信/ })).toBeNull();
  });
});
