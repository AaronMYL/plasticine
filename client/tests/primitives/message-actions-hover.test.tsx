// 消息下面那排操作图标（复制 / 引用）桌面上悬停或键盘聚焦才出现，触屏常显（用户视角审查 2026-11-01 第 10 条）。
// jsdom 没有悬停，所以直接核对样式表的规则。Plasticine 的回答 2026-11-05 起由线的视图画（views/lines/）。

import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import messageCss from '../../src/primitives/message/styles.css?raw';
import { UserMessage } from '../../src/primitives/message/index.tsx';

function rulesIn(sheet: CSSStyleSheet, condition: string): CSSStyleRule[] {
  return [...sheet.cssRules].flatMap((rule) => rule instanceof CSSMediaRule && rule.conditionText === condition
    ? [...rule.cssRules].filter((inner): inner is CSSStyleRule => inner instanceof CSSStyleRule) : []);
}

function topLevelStyleRules(sheet: CSSStyleSheet): CSSStyleRule[] {
  return [...sheet.cssRules].filter((rule): rule is CSSStyleRule => rule instanceof CSSStyleRule);
}

describe('消息操作图标 · 桌面悬停才出现', () => {
  const sheet = new CSSStyleSheet();
  sheet.replaceSync(messageCss);
  const hover = rulesIn(sheet, '(hover: hover) and (pointer: fine)');

  it('只在「有悬停、精细指针」的媒体里把安静操作设成 opacity 0，并保留占位；平时（触屏）没有这条规则', () => {
    const hidden = hover.find((rule) => rule.selectorText === '.msg-actions > .msg-quiet');
    expect(hidden?.style.opacity).toBe('0');
    expect(hidden?.style.visibility).toBe('');
    expect(hidden?.style.display).toBe('');
    expect(topLevelStyleRules(sheet).some((rule) => rule.selectorText.includes('.msg-quiet')
      && rule.style.opacity === '0')).toBe(false);
  });

  it('消息容器悬停、键盘焦点在里面时回到 opacity 1', () => {
    const shown = hover.find((rule) => rule.style.opacity === '1');
    expect(shown?.selectorText.split(',').map((part) => part.trim())).toEqual(expect.arrayContaining([
      '.msg:hover .msg-actions > .msg-quiet', '.msg:focus-within .msg-actions > .msg-quiet']));
  });

  it('复制、引用是安静操作', () => {
    render(<UserMessage text="你好" quotes={[]} state="sent" onQuote={() => undefined} />);
    expect(screen.getAllByRole('button', { name: '复制消息' }).every((b) => b.classList.contains('msg-quiet'))).toBe(true);
    expect(screen.getByRole('button', { name: '引用这句话' }).classList.contains('msg-quiet')).toBe(true);
  });
});

// 2026-11-04：你的话下面那排（复制 / 引用）往上找不到能悬停的「一行」，电脑上永远不出现、却一直空占一行，看不见也点得到。
describe('你的话 · 复制和引用', () => {
  const sheet = new CSSStyleSheet();
  sheet.replaceSync(messageCss);

  it('和 Plasticine 的回复一样，整条消息是悬停范围：悬停或键盘焦点进来才出现', () => {
    render(<UserMessage text="你好" quotes={[]} state="sent" onQuote={() => undefined} />);
    const copy = screen.getByRole('button', { name: '复制消息' });
    const row = copy.closest('li, article, tr, .reveal-scope');
    expect(row?.classList.contains('msg-user')).toBe(true);
    expect(copy.closest('.reveal-hover')).not.toBeNull();
  });

  it('不另占一行：和气泡排在同一行（气泡左边），这一行横排、底对齐', () => {
    render(<UserMessage text="你好" quotes={[]} state="sent" onQuote={() => undefined} />);
    const actions = screen.getByRole('button', { name: '复制消息' }).closest('.msg-user-actions');
    const line = actions?.parentElement;
    expect(line?.classList.contains('msg-user-line')).toBe(true);
    expect(line?.lastElementChild?.classList.contains('msg-bubble')).toBe(true);
    const rule = topLevelStyleRules(sheet).find((entry) => entry.selectorText === '.msg-user-line');
    expect(rule?.style.display).toBe('flex');
    expect(rule?.style.alignItems).toBe('flex-end');
  });

  it('电脑上没悬停时点不到（不再透明着照样能点）；触屏没有这条规则', () => {
    const hover = rulesIn(sheet, '(hover: hover)');
    const blocked = hover.find((rule) => rule.style.pointerEvents === 'none');
    expect(blocked?.selectorText).toBe('.msg-user:not(:hover):not(:focus-within) .msg-user-actions');
    expect(topLevelStyleRules(sheet).some((rule) => rule.style.pointerEvents === 'none')).toBe(false);
  });

  it('没有文字（只有图片等部件）时不出复制一排', () => {
    render(<UserMessage text="" quotes={[]} state="sent" widgets={<p>图片</p>} onQuote={() => undefined} />);
    expect(screen.queryByRole('button', { name: '复制消息' })).toBeNull();
  });
});
