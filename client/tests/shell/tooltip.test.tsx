// 悬停提示（2026-11-04 重做，用户定「锚在触发元素上；悬停约 500ms 才出、移开立即收，相邻之间瞬切；键盘聚焦出；
// 触屏点 ⓘ 出、点别处收；自动翻边贴边；可访问」）。浮框只放在 ⓘ 和图标按钮这类小元素上，不再整行。

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

describe('悬停提示 · 出现和收起', () => {
  it('鼠标停在图标按钮上约 500ms 才出，名字就是按钮的名字；移开立即收', async () => {
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

  it('还没到时间就移开：不出', async () => {
    render(<div><TooltipLayer /><IconButton icon="refresh" label="重新载入" /></div>);
    const button = screen.getByRole('button', { name: '重新载入' });
    hover(button);
    await wait(200);
    leave(button);
    await wait(TIP_DELAY);
    expect(tip()).toBeNull();
  });

  it('相邻之间瞬切：一个开着时移到另一个，不再等；刚收起不久移到下一个也不等，过了这段才重新等', async () => {
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

  it('按下按钮就收，鼠标不离开不再出', async () => {
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

  it('Esc、滚动、窗口失焦都收', async () => {
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

  it('空的 data-tip 不出；触屏划过不出', async () => {
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

describe('悬停提示 · 键盘与读屏', () => {
  it('键盘聚焦（:focus-visible）立即出，离开焦点就收；鼠标点出来的焦点不出', async () => {
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

  it('浮框 role="tooltip"，开着时说明经 aria-describedby 指过去；文字和名字一样时不重复指', async () => {
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

  it('ⓘ 有可访问名字，说明一直挂在 aria-description 上（读屏不必等浮框）', () => {
    render(<InfoTip label="「续写建议」的说明" text="停笔后显示续写候选" />);
    const info = screen.getByRole('button', { name: '「续写建议」的说明' });
    expect(info.getAttribute('aria-description')).toBe('停笔后显示续写候选');
    expect(info.classList.contains('info-tip')).toBe(true);
  });
});

describe('悬停提示 · 触屏点 ⓘ', () => {
  it('点 ⓘ 出，再点收；点别处收；点普通图标按钮不出', async () => {
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

  it('鼠标点 ⓘ 也立刻出（不用等）', async () => {
    render(<div><TooltipLayer /><InfoTip label="说明" text="过期日期" /></div>);
    const info = screen.getByRole('button', { name: '说明' });
    fireEvent.pointerDown(info, { pointerType: 'mouse' });
    fireEvent.click(info, { detail: 1 });
    await wait(0);
    expect(tip()?.textContent).toBe('过期日期');
  });
});

describe('悬停提示 · 位置与样式', () => {
  it('锚在元素上：默认在上面，fixed 定位，挂在 body 上，不接收指针', async () => {
    render(<div><TooltipLayer /><IconButton icon="refresh" label="重新载入" /></div>);
    hover(screen.getByRole('button', { name: '重新载入' }));
    await wait(TIP_DELAY + 10);
    const box = tip();
    expect(box?.parentElement).toBe(document.body);
    expect(box?.style.position).toBe('fixed');
    expect(box?.getAttribute('data-side')).toBe('top');
  });

  it('上面放不下就翻到下面，贴着窗口边不出去', async () => {
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

  it('data-tip-side 指定一侧', async () => {
    render(<div><TooltipLayer /><Tooltip content="展开对话栏" side="left"><button type="button">圆球</button></Tooltip>
    </div>);
    hover(screen.getByText('圆球'));
    await wait(TIP_DELAY + 10);
    expect(tip()?.getAttribute('data-side')).toBe('left');
  });

  it('方向 I：--fg 底 --bg 字、12/18·500、padding 4 8、圆角 4、没有阴影；动效从所在一侧位移，减少动态效果只淡入淡出', () => {
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(tooltipCss);
    const rules = [...sheet.cssRules].filter((rule): rule is CSSStyleRule => rule instanceof CSSStyleRule);
    const base = rules.find((rule) => rule.selectorText === '.tooltip');
    expect(base?.style.background).toBe('var(--fg)');
    expect(base?.style.color).toBe('var(--bg)');
    expect(base?.style.fontSize).toBe('12px');
    expect(base?.style.lineHeight).toBe('18px');
    expect(base?.style.fontWeight).toBe('500');
    expect(base?.style.padding).toBe('4px 8px');
    expect(base?.style.borderRadius).toBe('4px');
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
