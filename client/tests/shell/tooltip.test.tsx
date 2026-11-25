import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import tooltipCss from '../../src/shell/tooltip.css?raw';
import { IconButton } from '../../src/shell/icon-button.tsx';
import { InfoTip } from '../../src/shell/info-tip.tsx';
import { TIP_DELAY, TIP_SKIP_WINDOW, Tooltip, TooltipLayer } from '../../src/shell/tooltip.tsx';

function hover(target: Element, pointerType = 'mouse'): void {
  fireEvent.pointerOver(target, { pointerType, bubbles: true });
}

function leave(target: Element, to: Element | null = document.body, pointerType = 'mouse'): void {
  fireEvent.pointerOut(target, { pointerType, bubbles: true, relatedTarget: to });
}

function tip(): HTMLElement | null {
  return document.querySelector<HTMLElement>('[role="tooltip"]');
}

async function wait(ms: number): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('tooltip: show and hide', () => {
  it('hovering icon button shows tooltip after ~500ms with button label and hides on leave', async () => {
    render(<div><TooltipLayer /><IconButton icon="refresh" label="重新载入" /><p>别处</p></div>);
    const button = screen.getByRole('button', { name: '重新载入' });
    expect(button.getAttribute('title')).toBeNull();
    hover(button);
    await wait(TIP_DELAY - 50);
    expect(tip()).toBeNull();
    await wait(60);
    expect(tip()?.textContent).toBe('重新载入');
    leave(button, screen.getByText('别处'));
    await wait(0);
    expect(tip()?.getAttribute('data-status')).not.toBe('open');
    await wait(200);
    expect(tip()).toBeNull();
  });

  it('moving pointer away before delay prevents tooltip from showing', async () => {
    render(<div><TooltipLayer /><IconButton icon="refresh" label="重新载入" /></div>);
    const button = screen.getByRole('button', { name: '重新载入' });
    hover(button);
    await wait(200);
    leave(button);
    await wait(TIP_DELAY);
    expect(tip()).toBeNull();
  });

  it('switches immediately between adjacent buttons or shortly after hide before resetting delay', async () => {
    render(<div><TooltipLayer /><IconButton icon="back" label="后退" /><IconButton icon="forward" label="前进" />
      <IconButton icon="refresh" label="重新载入" /></div>);
    const back = screen.getByRole('button', { name: '后退' });
    const forward = screen.getByRole('button', { name: '前进' });
    const reload = screen.getByRole('button', { name: '重新载入' });
    hover(back);
    await wait(TIP_DELAY + 10);
    leave(back, forward);
    hover(forward);
    await wait(0);
    expect(tip()?.textContent).toBe('前进');
    leave(forward);
    await wait(TIP_SKIP_WINDOW - 100);
    hover(reload);
    await wait(0);
    expect(tip()?.textContent).toBe('重新载入');
    leave(reload);
    await wait(TIP_SKIP_WINDOW + 100);
    hover(back);
    await wait(100);
    expect(tip()).toBeNull();
    await wait(TIP_DELAY);
    expect(tip()?.textContent).toBe('后退');
  });

  it('pressing button hides tooltip and keeps it hidden until pointer leaves', async () => {
    render(<div><TooltipLayer /><IconButton icon="refresh" label="重新载入" /></div>);
    const button = screen.getByRole('button', { name: '重新载入' });
    hover(button);
    await wait(TIP_DELAY + 10);
    expect(tip()).not.toBeNull();
    fireEvent.pointerDown(button, { pointerType: 'mouse' });
    await wait(200);
    expect(tip()).toBeNull();
    hover(button);
    await wait(TIP_DELAY + 10);
    expect(tip()).toBeNull();
  });

  it('Esc, scroll, and window blur all hide tooltip', async () => {
    render(<div><TooltipLayer /><IconButton icon="refresh" label="重新载入" /></div>);
    const button = screen.getByRole('button', { name: '重新载入' });
    for (const dismiss of [
      () => fireEvent.keyDown(document, { key: 'Escape' }),
      () => fireEvent.scroll(document),
      () => fireEvent.blur(window),
    ]) {
      leave(button);
      await wait(TIP_SKIP_WINDOW + 10);
      hover(button);
      await wait(TIP_DELAY + 10);
      expect(tip()).not.toBeNull();
      dismiss();
      await wait(200);
      expect(tip()).toBeNull();
    }
  });

  it('empty data-tip and touch hover do not show tooltip', async () => {
    render(<div><TooltipLayer /><button type="button" data-tip="  ">空</button>
      <IconButton icon="refresh" label="重新载入" /></div>);
    hover(screen.getByText('空'));
    await wait(TIP_DELAY + 10);
    expect(tip()).toBeNull();
    hover(screen.getByRole('button', { name: '重新载入' }), 'touch');
    await wait(TIP_DELAY + 10);
    expect(tip()).toBeNull();
  });
});

describe('tooltip: keyboard and screen reader', () => {
  it('keyboard focus-visible shows tooltip immediately and hides on blur; mouse focus does not', async () => {
    render(<div><TooltipLayer /><InfoTip label="委托来源" text="2026-11-01 你在对话里说的" /></div>);
    const info = screen.getByRole('button', { name: '委托来源' });
    const visible = vi.spyOn(info, 'matches').mockImplementation((selector) => selector === ':focus-visible');
    act(() => info.focus());
    await wait(0);
    expect(tip()?.textContent).toBe('2026-11-01 你在对话里说的');
    act(() => info.blur());
    await wait(200);
    expect(tip()).toBeNull();
    visible.mockReturnValue(false);
    act(() => info.focus());
    await wait(TIP_DELAY + 10);
    expect(tip()).toBeNull();
  });

  it('tooltip uses role=tooltip and aria-describedby when open, skipping duplicate name text', async () => {
    render(<div><TooltipLayer /><Tooltip content="11:20 失效"><span tabIndex={0}>订阅</span></Tooltip>
      <IconButton icon="refresh" label="重新载入" /></div>);
    const host = screen.getByText('订阅');
    hover(host);
    await wait(TIP_DELAY + 10);
    const box = tip();
    expect(box?.id).not.toBe('');
    expect(host.getAttribute('aria-describedby')).toBe(box?.id);
    leave(host);
    await wait(200);
    expect(host.hasAttribute('aria-describedby')).toBe(false);
    const button = screen.getByRole('button', { name: '重新载入' });
    hover(button);
    await wait(TIP_DELAY + 10);
    expect(button.hasAttribute('aria-describedby')).toBe(false);
  });

  it('info icon has accessible name and keeps description on aria-description at all times', () => {
    render(<InfoTip label="「续写建议」的说明" text="停笔后显示续写候选" />);
    const info = screen.getByRole('button', { name: '「续写建议」的说明' });
    expect(info.getAttribute('aria-description')).toBe('停笔后显示续写候选');
    expect(info.classList.contains('info-tip')).toBe(true);
  });
});

describe('tooltip: touch tap on info icon', () => {
  it('tapping info icon toggles tooltip and tapping outside hides it; regular buttons ignore', async () => {
    render(<div><TooltipLayer /><InfoTip label="说明" text="过期日期" /><p>别处</p>
      <IconButton icon="refresh" label="重新载入" /></div>);
    const info = screen.getByRole('button', { name: '说明' });
    fireEvent.pointerDown(info, { pointerType: 'touch' });
    fireEvent.click(info, { detail: 1 });
    await wait(0);
    expect(tip()?.textContent).toBe('过期日期');
    fireEvent.pointerDown(info, { pointerType: 'touch' });
    fireEvent.click(info, { detail: 1 });
    await wait(200);
    expect(tip()).toBeNull();
    fireEvent.pointerDown(info, { pointerType: 'touch' });
    fireEvent.click(info, { detail: 1 });
    await wait(0);
    fireEvent.pointerDown(screen.getByText('别处'), { pointerType: 'touch' });
    await wait(200);
    expect(tip()).toBeNull();
    const reload = screen.getByRole('button', { name: '重新载入' });
    fireEvent.pointerDown(reload, { pointerType: 'touch' });
    fireEvent.click(reload, { detail: 1 });
    await wait(TIP_DELAY + 10);
    expect(tip()).toBeNull();
  });

  it('clicking info icon with mouse shows tooltip immediately without delay', async () => {
    render(<div><TooltipLayer /><InfoTip label="说明" text="过期日期" /></div>);
    const info = screen.getByRole('button', { name: '说明' });
    fireEvent.pointerDown(info, { pointerType: 'mouse' });
    fireEvent.click(info, { detail: 1 });
    await wait(0);
    expect(tip()?.textContent).toBe('过期日期');
  });
});

describe('tooltip: placement and styling', () => {
  it('anchors above element by default, fixed-positioned on body with pointer-events none', async () => {
    render(<div><TooltipLayer /><IconButton icon="refresh" label="重新载入" /></div>);
    hover(screen.getByRole('button', { name: '重新载入' }));
    await wait(TIP_DELAY + 10);
    const box = tip();
    expect(box?.parentElement).toBe(document.body);
    expect(box?.style.position).toBe('fixed');
    expect(box?.getAttribute('data-side')).toBe('top');
  });

  it('flips below when clipped at top and clamps within viewport edges', async () => {
    const box = (left: number, top: number, width: number, height: number): DOMRect => ({
      x: left, y: top, left, top, width, height, right: left + width, bottom: top + height, toJSON: () => ({}),
    });
    vi.spyOn(document.documentElement, 'clientWidth', 'get').mockReturnValue(1000);
    vi.spyOn(document.documentElement, 'clientHeight', 'get').mockReturnValue(800);
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function rect(this: Element) {
      if (this.getAttribute('role') === 'tooltip') {
        return box(0, 0, 120, 26);
      }
      return this.hasAttribute('data-tip') ? box(4, 2, 28, 28) : box(0, 0, 0, 0);
    });
    render(<div><TooltipLayer /><IconButton icon="sidebar" label="收起侧栏" /></div>);
    hover(screen.getByRole('button', { name: '收起侧栏' }));
    await wait(TIP_DELAY + 10);
    await wait(10);
    const shown = tip();
    expect(shown?.getAttribute('data-side')).toBe('bottom');
    expect(Number.parseFloat(shown?.style.left ?? '')).toBeGreaterThanOrEqual(8);
  });

  it('respects data-tip-side placement override', async () => {
    render(<div><TooltipLayer /><Tooltip content="展开对话栏" side="left"><button type="button">圆球</button></Tooltip>
    </div>);
    hover(screen.getByText('圆球'));
    await wait(TIP_DELAY + 10);
    expect(tip()?.getAttribute('data-side')).toBe('left');
  });

  it('uses fg/bg tokens, 12/18 500 type, 4x8 padding, 4px radius, no shadow, reduced-motion fade', () => {
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(tooltipCss);
    const rules = [...sheet.cssRules].filter((rule): rule is CSSStyleRule => rule instanceof CSSStyleRule);
    const base = rules.find((rule) => rule.selectorText === '.tooltip');
    expect(base?.style.background).toBe('var(--fg)');
    expect(base?.style.color).toBe('var(--bg)');
    expect(base?.style.fontSize).toBe('var(--text-caption)');
    expect(base?.style.lineHeight).toBe('var(--text-caption-line)');
    expect(base?.style.fontWeight).toBe('500');
    expect(base?.style.padding).toBe('var(--space-1) var(--space-2)');
    expect(base?.style.borderRadius).toBe('var(--radius-sm)');
    expect(base?.style.boxShadow).toBe('');
    expect(base?.style.pointerEvents).toBe('none');
    const sides = rules.filter((rule) => rule.selectorText.startsWith('.tooltip[data-side='));
    expect(sides.length).toBe(4);
    const reduced = [...sheet.cssRules].find((rule): rule is CSSMediaRule => rule instanceof CSSMediaRule
      && rule.conditionText === '(prefers-reduced-motion: reduce)');
    const still = [...(reduced?.cssRules ?? [])].find((rule): rule is CSSStyleRule => rule instanceof CSSStyleRule);
    expect(still?.style.transform).toBe('none');
  });
});
