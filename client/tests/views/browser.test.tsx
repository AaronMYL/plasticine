import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { BrowserSurface, pagePoint } from '../../src/views/tools/browser-surface.tsx';
import type { BrowserFrame } from '../../src/api/shared.ts';
import { memoryStorage, renderApp } from '../helpers.tsx';
import browserCss from '../../src/views/tools/browser.css?raw';

const frame = (sequence: number): BrowserFrame => ({
  sequence, tabId: 'tab-1', data: 'YWJj', width: 1280, height: 800,
});
afterEach(() => vi.unstubAllGlobals());
beforeEach(() => {
  vi.stubGlobal('Image', class {
    onload: (() => void) | null = null;
    width = 1280;
    height = 800;
    set src(_value: string) { this.onload?.(); }
  });
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage: vi.fn() } as unknown as
    CanvasRenderingContext2D);
});

it('frame coordinates stay 1:1 CSS pixels regardless of image DPR or stale frames on resize', () => {
  const rect = { left: 10, top: 20, width: 640, height: 400 };
  expect(pagePoint(330, 220, rect, frame(1))).toEqual({ x: 320, y: 200 });
  expect(pagePoint(-1, 900, rect, frame(1))).toEqual({ x: 0, y: 799 });
});

it('out-of-order async decodes draw only the latest frame and ack after draw', async () => {
  const images: { onload: (() => void) | null; src: string; width: number; height: number }[] = [];
  class TestImage {
    onload: (() => void) | null = null;
    src = '';
    width = 640;
    height = 400;
    constructor() { images.push(this); }
  }
  vi.stubGlobal('Image', TestImage);
  const draw = vi.fn();
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage: draw } as unknown as
    CanvasRenderingContext2D);
  const ack = vi.fn();
  const view = render(<BrowserSurface frame={frame(1)} onAction={vi.fn()} onAck={ack} onError={vi.fn()} />);
  view.rerender(<BrowserSurface frame={frame(2)} onAction={vi.fn()} onAck={ack} onError={vi.fn()} />);
  act(() => images[1]?.onload?.());
  act(() => images[0]?.onload?.());
  expect(draw).toHaveBeenCalledTimes(1);
  expect(draw.mock.calls[0]?.[0]).toBe(images[1]);
  expect(ack).toHaveBeenCalledWith(2);
  expect(ack).not.toHaveBeenCalledWith(1);
});

it('focused canvas forwards keys and CJK commits without duplicate composition or leftover text', async () => {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
  const send = vi.fn();
  render(<BrowserSurface frame={frame(1)} onAction={send} onAck={vi.fn()} onError={vi.fn()} />);
  const keyboard = screen.getByRole('textbox', { name: '浏览器键盘输入' });
  fireEvent.keyDown(keyboard, { key: 'Enter', code: 'Enter' });
  fireEvent.keyUp(keyboard, { key: 'Enter', code: 'Enter' });
  expect(send).toHaveBeenCalledWith(expect.objectContaining({ kind: 'key', event: 'down', key: 'Enter' }));
  expect(send).toHaveBeenCalledWith(expect.objectContaining({ kind: 'key', event: 'up', key: 'Enter' }));
  fireEvent.compositionStart(keyboard);
  fireEvent.input(keyboard, { target: { value: '中文' }, isComposing: true });
  expect(send).not.toHaveBeenCalledWith({ kind: 'type', text: '中文' });
  fireEvent.compositionEnd(keyboard, { data: '中文' });
  fireEvent.input(keyboard, { target: { value: '中文' }, data: '中文' });
  expect(send.mock.calls.filter(([action]) => action.kind === 'type')).toEqual([[{ kind: 'type', text: '中文' }]]);
  expect((keyboard as HTMLTextAreaElement).value).toBe('');
  const pasteKey = new KeyboardEvent('keydown', { key: 'v', code: 'KeyV', ctrlKey: true,
    cancelable: true, bubbles: true });
  fireEvent(keyboard, pasteKey);
  expect(pasteKey.defaultPrevented).toBe(false);
  fireEvent.paste(keyboard, { clipboardData: { getData: () => '粘贴的中文' } });
  expect(send).toHaveBeenCalledWith({ kind: 'type', text: '粘贴的中文' });
});

it('browser is a main-pane route with secondary actions in menu and hides brain badge when idle', async () => {
  const app = await renderApp();
  const opened = vi.spyOn(app.api.browser, 'open');
  act(() => {
    window.location.hash = '#/web';
    window.dispatchEvent(new HashChangeEvent('hashchange'));
  });
  fireEvent.click(within(screen.getByRole('main')).getByRole('button', { name: /^浏览器/ }));
  await screen.findByRole('textbox', { name: '地址栏' });
  expect(window.location.hash).toBe('#/browser');
  expect(screen.queryByRole('dialog', { name: '浏览器' })).toBeNull();
  expect(screen.queryByText(/点击画面后可以输入/)).toBeNull();
  expect(screen.queryByText(/Plasticine 正在用这个浏览器/)).toBeNull();
  expect(screen.queryByRole('button', { name: '向上滚动' })).toBeNull();
  expect(screen.queryByText(/开发期干跑：页面上的动作只记下/)).toBeNull();
  expect(screen.getByRole('button', { name: '新开标签页' })).toBeTruthy();
  const address = screen.getByRole('textbox', { name: '地址栏' });
  fireEvent.change(address, { target: { value: 'http://example.com/a?keyword=中文' } });
  await act(async () => { fireEvent.keyDown(address, { key: 'Enter' }); });
  await waitFor(() => expect(screen.getByRole('tab', { name: /示例/ })).toBeTruthy());
  expect(opened).toHaveBeenCalledWith(expect.objectContaining({ url: 'http://example.com/a?keyword=中文' }));
});

it('browser secondary menu opens on demand, closes on Escape restoring focus, closes on action', async () => {
  const app = await renderApp({ hash: '#/browser' });
  await screen.findByRole('textbox', { name: '地址栏' });
  const change = vi.spyOn(app.api.browser, 'tab');
  expect(screen.queryByRole('button', { name: '清空登录' })).toBeNull();
  const more = screen.getByRole('button', { name: '更多浏览器操作' });
  fireEvent.click(more);
  expect(screen.getByRole('button', { name: '关掉所有标签页' })).toBeTruthy();
  fireEvent.keyDown(document.activeElement ?? document, { key: 'Escape' });
  expect(screen.queryByRole('button', { name: '清空登录' })).toBeNull();
  expect(document.activeElement).toBe(more);
  expect(change).not.toHaveBeenCalled();
  fireEvent.click(more);
  fireEvent.click(screen.getByRole('button', { name: '清空登录' }));
  await waitFor(() => expect(change).toHaveBeenCalledWith(
    expect.objectContaining({ action: { kind: 'clear_login' } }),
  ));
  expect(screen.queryByRole('button', { name: '清空登录' })).toBeNull();
});

it('out-of-order stale frame seq skips decode; manual CJK input stays out of browser drafts', async () => {
  const images: { src: string; onload: (() => void) | null; width: number; height: number }[] = [];
  class TestImage {
    src = '';
    onload: (() => void) | null = null;
    width = 640;
    height = 400;
    constructor() { images.push(this); }
  }
  vi.stubGlobal('Image', TestImage);
  const draw = vi.fn();
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage: draw } as unknown as
    CanvasRenderingContext2D);
  const storage = memoryStorage();
  const app = await renderApp({ storage, setup(fake) {
    fake.control.toolGroups.browser.seed({ open: true, activeTabId: 'tab-1', url: 'https://example.com/',
      tabs: [{ id: 'tab-1', title: '示例', url: 'https://example.com/' }] });
  } });
  act(() => {
    window.location.hash = '#/web';
    window.dispatchEvent(new HashChangeEvent('hashchange'));
  });
  fireEvent.click(within(screen.getByRole('main')).getByRole('button', { name: /^浏览器/ }));
  await screen.findByRole('textbox', { name: '地址栏' });
  act(() => app.control.toolGroups.browser.emitFrame(frame(3)));
  act(() => app.control.toolGroups.browser.emitFrame(frame(2)));
  expect(images.length).toBe(1);
  act(() => images[0]?.onload?.());
  await waitFor(() => expect(app.control.toolGroups.browser.acknowledgements).toEqual([3]));
  const keyboard = screen.getByRole('textbox', { name: '浏览器键盘输入' });
  fireEvent.input(keyboard, { target: { value: '只在当前浏览器中输入' } });
  await waitFor(() => expect(app.control.toolGroups.browser.actions).toContainEqual({
    kind: 'type', text: '只在当前浏览器中输入',
  }));
  expect(JSON.stringify([...storage.data.values()])).not.toContain('只在当前浏览器中输入');
  expect(app.state.actionOps.store.get().length).toBe(0);
});

it('shows retry when browser is down, allows new tabs after recovery, updates brain badge', async () => {
  const app = await renderApp({ setup(fake) { fake.control.toolGroups.browser.seed({ available: false }); } });
  act(() => {
    window.location.hash = '#/web';
    window.dispatchEvent(new HashChangeEvent('hashchange'));
  });
  fireEvent.click(within(screen.getByRole('main')).getByRole('button', { name: /^浏览器/ }));
  expect(await screen.findByText('浏览器还没起来')).toBeTruthy();
  expect((screen.getByRole('button', { name: '新开标签页' }) as HTMLButtonElement).disabled).toBe(true);
  act(() => app.control.toolGroups.browser.seed({ available: true, controller: 'brain' }));
  fireEvent.click(screen.getByRole('button', { name: '新开标签页' }));
  await screen.findByRole('tab', { name: '新标签页' });
  expect(screen.queryByText('浏览器还没起来')).toBeNull();
  expect(screen.queryByText(/Plasticine 正在用这个浏览器/)).toBeNull();
});

it('wheel scrolls remote page only and blur releases held modifier keys', () => {
  const send = vi.fn();
  render(<BrowserSurface frame={frame(1)} onAction={send} onAck={vi.fn()} onError={vi.fn()} />);
  const surface = screen.getByRole('group', { name: '浏览器画面' });
  vi.spyOn(surface, 'getBoundingClientRect').mockReturnValue({
    x: 0, y: 0, left: 0, top: 0, right: 640, bottom: 400, width: 640, height: 400,
    toJSON: () => undefined,
  });
  const wheel = new WheelEvent('wheel', { clientX: 320, clientY: 200, deltaY: 3, deltaMode: 1, cancelable: true });
  fireEvent(surface, wheel);
  expect(wheel.defaultPrevented).toBe(true);
  expect(send).toHaveBeenCalledWith({ kind: 'scroll', x: 320, y: 200, dx: 0, dy: 48 });
  const keyboard = screen.getByRole('textbox', { name: '浏览器键盘输入' });
  fireEvent.keyDown(keyboard, { key: 'Control', code: 'ControlLeft', ctrlKey: true });
  fireEvent.blur(keyboard);
  expect(send).toHaveBeenLastCalledWith(expect.objectContaining({
    kind: 'key', key: 'Control', event: 'up', modifiers: 0,
  }));
});

function touch(element: HTMLElement, type: string, x: number, y: number): void {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0 });
  Object.defineProperties(event, { pointerId: { value: 1 }, pointerType: { value: 'touch' } });
  fireEvent(element, event);
}

it('mobile single-finger drag sends inverted wheel without clicking or focusing keyboard', () => {
  const send = vi.fn();
  render(<BrowserSurface frame={frame(1)} onAction={send} onAck={vi.fn()} onError={vi.fn()} />);
  const surface = screen.getByRole('group', { name: '浏览器画面' });
  touch(surface, 'pointerdown', 100, 200);
  touch(surface, 'pointermove', 110, 140);
  touch(surface, 'pointermove', 110, 120);
  touch(surface, 'pointerup', 110, 120);
  expect(send.mock.calls.map(([action]) => action)).toEqual([
    { kind: 'scroll', x: 110, y: 140, dx: -10, dy: 60 },
    { kind: 'scroll', x: 110, y: 120, dx: 0, dy: 20 },
  ]);
  expect(document.activeElement).not.toBe(screen.getByRole('textbox', { name: '浏览器键盘输入' }));
});

it('mobile tap sends single CSS-pixel click without opening soft keyboard on non-editable', () => {
  const send = vi.fn();
  render(<BrowserSurface frame={frame(1)} onAction={send} onAck={vi.fn()} onError={vi.fn()} />);
  const surface = screen.getByRole('group', { name: '浏览器画面' });
  touch(surface, 'pointerdown', 100, 200);
  touch(surface, 'pointerup', 102, 201);
  expect(send.mock.calls[0]?.[0]).toEqual({ kind: 'click', x: 102, y: 201 });
  expect(send).toHaveBeenCalledTimes(1);
  expect(document.activeElement).not.toBe(screen.getByRole('textbox', { name: '浏览器键盘输入' }));
});

it('releasing modifier before shortcut key still releases pressed char; blur avoids duplicate', () => {
  const send = vi.fn();
  render(<BrowserSurface frame={frame(1)} onAction={send} onAck={vi.fn()} onError={vi.fn()} />);
  const keyboard = screen.getByRole('textbox', { name: '浏览器键盘输入' });
  fireEvent.keyDown(keyboard, { key: 'Control', code: 'ControlLeft', ctrlKey: true });
  fireEvent.keyDown(keyboard, { key: 'a', code: 'KeyA', ctrlKey: true });
  fireEvent.keyUp(keyboard, { key: 'Control', code: 'ControlLeft' });
  fireEvent.keyUp(keyboard, { key: 'a', code: 'KeyA' });
  expect(send).toHaveBeenLastCalledWith(expect.objectContaining({ key: 'a', event: 'up', modifiers: 0 }));
  const count = send.mock.calls.length;
  fireEvent.blur(keyboard);
  expect(send).toHaveBeenCalledTimes(count);
});

it('soft keyboard delete forwards Backspace/Delete without duplicating physical or IME keys', () => {
  const send = vi.fn();
  render(<BrowserSurface frame={frame(1)} onAction={send} onAck={vi.fn()} onError={vi.fn()} />);
  const keyboard = screen.getByRole('textbox', { name: '浏览器键盘输入' });
  const remove = (inputType: string, isComposing = false): void => {
    fireEvent(keyboard, new InputEvent('beforeinput', { inputType, isComposing, bubbles: true, cancelable: true }));
  };
  fireEvent.keyDown(keyboard, { key: 'Unidentified', code: '' });
  remove('deleteContentBackward');
  remove('deleteContentForward');
  expect(send.mock.calls.map(([action]) => action)).toEqual([
    { kind: 'key', key: 'Backspace' }, { kind: 'key', key: 'Delete' },
  ]);
  send.mockClear();
  fireEvent.keyDown(keyboard, { key: 'Backspace', code: 'Backspace' });
  remove('deleteContentBackward');
  fireEvent.keyUp(keyboard, { key: 'Backspace', code: 'Backspace' });
  remove('deleteContentBackward', true);
  expect(send.mock.calls.map(([action]) => action.event)).toEqual(['down', 'up']);
});

it('unknown beforeinput types pass through natively without matching Object.prototype keys', () => {
  const send = vi.fn();
  render(<BrowserSurface frame={frame(1)} onAction={send} onAck={vi.fn()} onError={vi.fn()} />);
  const keyboard = screen.getByRole('textbox', { name: '浏览器键盘输入' });
  for (const inputType of ['insertText', 'historyUndo', '', 'toString', 'constructor', '__proto__']) {
    const event = new InputEvent('beforeinput', { inputType, bubbles: true, cancelable: true });
    fireEvent(keyboard, event);
    expect(event.defaultPrevented).toBe(false);
  }
  expect(send).not.toHaveBeenCalled();
});

it.each(['暂停', '无画面', '切页'] as const)('%s 时自动释放已按下的键，迟到松键和失焦不重复释放', (reason) => {
  const send = vi.fn();
  const view = render(<BrowserSurface frame={frame(1)} onAction={send} onAck={vi.fn()} onError={vi.fn()} />);
  const surface = screen.getByRole('group', { name: '浏览器画面' });
  fireEvent.keyDown(surface, { key: 'Control', code: 'ControlLeft', ctrlKey: true });
  const nextFrame = reason === '切页' ? { ...frame(2), tabId: 'tab-2' } : frame(2);
  view.rerender(<BrowserSurface frame={reason === '无画面' ? null : nextFrame} disabled={reason === '暂停'}
    onAction={send} onAck={vi.fn()} onError={vi.fn()} />);
  expect(send.mock.calls.map(([action]) => action.event)).toEqual(['down', 'up']);
  expect(send).toHaveBeenLastCalledWith(expect.objectContaining({ key: 'Control', modifiers: 0, repeat: false }));
  fireEvent.keyUp(surface, { key: 'Control', code: 'ControlLeft' });
  fireEvent.blur(surface);
  expect(send.mock.calls.map(([action]) => action.event)).toEqual(['down', 'up']);
});

const twoTabs = {
  open: true, activeTabId: 'tab-1', url: 'https://example.com/',
  tabs: [{ id: 'tab-1', title: '第一页', url: 'https://example.com/' },
    { id: 'tab-2', title: '第二页', url: 'https://example.com/other' }],
};

it('tab switch waits for key-release ack; paused keyup and blur do not resend', async () => {
  const app = await renderApp({ hash: '#/browser', setup(fake) { fake.control.toolGroups.browser.seed(twoTabs); } });
  act(() => app.control.toolGroups.browser.emitFrame(frame(1)));
  const original = app.api.browser.act.bind(app.api.browser);
  const order: string[] = [];
  let release: (() => void) | undefined;
  const send = vi.spyOn(app.api.browser, 'act').mockImplementation(async (input) => {
    if (input.action.kind === 'key') {
      order.push(`${input.tabId}:${input.action.event}`);
      if (input.action.event === 'up') {
        await new Promise<void>((resolve) => { release = resolve; });
      }
    }
    return original(input);
  });
  const originalTab = app.api.browser.tab.bind(app.api.browser);
  const tab = vi.spyOn(app.api.browser, 'tab').mockImplementation(async (input) => {
    order.push('switch');
    return originalTab(input);
  });
  const surface = screen.getByRole('group', { name: '浏览器画面' });
  await act(async () => { fireEvent.keyDown(surface, { key: 'Control', code: 'ControlLeft', ctrlKey: true }); });
  try {
    await act(async () => { fireEvent.click(screen.getByRole('tab', { name: '第二页' })); });
    expect(order).toEqual(['tab-1:down', 'tab-1:up']);
    expect(tab).not.toHaveBeenCalled();
    expect(surface.getAttribute('aria-disabled')).toBe('true');
    fireEvent.keyUp(surface, { key: 'Control', code: 'ControlLeft' });
    fireEvent.blur(surface);
  } finally {
    await act(async () => release?.());
  }
  await waitFor(() => expect(order).toEqual(['tab-1:down', 'tab-1:up', 'switch']));
  act(() => app.control.toolGroups.browser.emitFrame({ ...frame(2), tabId: 'tab-2' }));
  fireEvent.keyUp(surface, { key: 'Control', code: 'ControlLeft' });
  expect(send.mock.calls.map(([input]) => input.tabId)).toEqual(['tab-1', 'tab-1']);
});

it('stream rebuild releases old keys and rejects new input until fresh frame arrives', async () => {
  let resize: ResizeObserverCallback | undefined;
  let element: Element | undefined;
  vi.stubGlobal('ResizeObserver', class {
    private readonly callback: ResizeObserverCallback;
    constructor(callback: ResizeObserverCallback) { this.callback = callback; }
    observe(target: Element) {
      if (target.closest('.line-scroll') !== null) return;
      resize = this.callback;
      element = target;
    }
    disconnect() {  }
  });
  const app = await renderApp({ hash: '#/browser', setup(fake) { fake.control.toolGroups.browser.seed(twoTabs); } });
  const notify = (width: number): void => {
    resize?.([{ target: element, contentRect: { width, height: 700 } } as ResizeObserverEntry], {} as ResizeObserver);
  };
  act(() => notify(600));
  act(() => app.control.toolGroups.browser.emitFrame(frame(1)));
  const keyboard = screen.getByRole('textbox', { name: '浏览器键盘输入' });
  const send = vi.spyOn(app.api.browser, 'act');
  await act(async () => { fireEvent.keyDown(keyboard, { key: 'Control', code: 'ControlLeft', ctrlKey: true }); });
  const originalStream = app.api.browser.stream.bind(app.api.browser);
  vi.spyOn(app.api.browser, 'stream').mockImplementation((query, event, error) => originalStream(query, (value) => {
    if (value.type !== 'frame') {
      event(value);
    }
  }, error));
  vi.useFakeTimers();
  try {
    act(() => notify(700));
    await act(async () => vi.advanceTimersByTime(300));
    fireEvent.keyUp(keyboard, { key: 'Control', code: 'ControlLeft' });
    fireEvent.blur(keyboard);
    await act(async () => { fireEvent.input(keyboard, { target: { value: '暂停时的输入' } }); });
    expect((keyboard as HTMLTextAreaElement).disabled).toBe(true);
    expect(send.mock.calls.map(([input]) => ({ tabId: input.tabId, action: input.action }))).toEqual([
      { tabId: 'tab-1', action: expect.objectContaining({ key: 'Control', event: 'down' }) },
      { tabId: 'tab-1', action: expect.objectContaining({ key: 'Control', event: 'up', modifiers: 0 }) },
    ]);
  } finally {
    vi.useRealTimers();
  }
});

it('leaving browser before keydown ack still releases keys on original tab in order', async () => {
  const app = await renderApp({ hash: '#/browser', setup(fake) { fake.control.toolGroups.browser.seed(twoTabs); } });
  act(() => app.control.toolGroups.browser.emitFrame(frame(1)));
  const original = app.api.browser.act.bind(app.api.browser);
  let release: (() => void) | undefined;
  const send = vi.spyOn(app.api.browser, 'act').mockImplementationOnce(async (input) => {
    const response = await original(input);
    await new Promise<void>((resolve) => { release = resolve; });
    return response;
  });
  const keyboard = screen.getByRole('textbox', { name: '浏览器键盘输入' });
  await act(async () => { fireEvent.keyDown(keyboard, { key: 'Shift', code: 'ShiftLeft', shiftKey: true }); });
  try {
    app.view.unmount();
  } finally {
    await act(async () => release?.());
  }
  expect(send.mock.calls.map(([input]) => input.action)).toEqual([
    expect.objectContaining({ key: 'Shift', event: 'down' }),
    expect.objectContaining({ key: 'Shift', event: 'up', modifiers: 0 }),
  ]);
  expect(send.mock.calls.map(([input]) => input.tabId)).toEqual(['tab-1', 'tab-1']);
});

it('full input queue still reserves keyup cleanup so remote modifiers never stick', async () => {
  const app = await renderApp({ hash: '#/browser', setup(fake) { fake.control.toolGroups.browser.seed(twoTabs); } });
  act(() => app.control.toolGroups.browser.emitFrame(frame(1)));
  const original = app.api.browser.act.bind(app.api.browser);
  let release: (() => void) | undefined;
  vi.spyOn(app.api.browser, 'act').mockImplementationOnce(async (input) => {
    const response = await original(input);
    await new Promise<void>((resolve) => { release = resolve; });
    return response;
  });
  const keyboard = screen.getByRole('textbox', { name: '浏览器键盘输入' });
  await act(async () => { fireEvent.keyDown(keyboard, { key: 'Control', code: 'ControlLeft', ctrlKey: true }); });
  try {
    for (let index = 0; index < 200; index += 1) {
      fireEvent.input(keyboard, { target: { value: `排队文字 ${index}` } });
    }
    expect(screen.getByText('操作发送得太快，请等画面更新后重试。')).toBeTruthy();
    fireEvent.keyUp(keyboard, { key: 'Control', code: 'ControlLeft' });
  } finally {
    await act(async () => release?.());
  }
  expect(app.control.toolGroups.browser.actions.at(-1)).toMatchObject({ key: 'Control', event: 'up', modifiers: 0 });
  expect(app.control.toolGroups.browser.actions.filter((input) => input.kind === 'key')).toHaveLength(2);
});

it('failed key release retains pending keys, reports error, and blocks tab switch until retried', async () => {
  const app = await renderApp({ hash: '#/browser', setup(fake) { fake.control.toolGroups.browser.seed(twoTabs); } });
  act(() => app.control.toolGroups.browser.emitFrame(frame(1)));
  const original = app.api.browser.act.bind(app.api.browser);
  let failed = false;
  const send = vi.spyOn(app.api.browser, 'act').mockImplementation(async (input) => {
    if (input.action.kind === 'key' && input.action.event === 'up' && !failed) {
      failed = true;
      throw new Error('松键没有收到回执，请重试。');
    }
    return original(input);
  });
  const tab = vi.spyOn(app.api.browser, 'tab');
  const keyboard = screen.getByRole('textbox', { name: '浏览器键盘输入' });
  await act(async () => { fireEvent.keyDown(keyboard, { key: 'Shift', code: 'ShiftLeft', shiftKey: true }); });
  await act(async () => { fireEvent.click(screen.getByRole('tab', { name: '第二页' })); });
  expect(screen.getByText('松键没有收到回执，请重试。')).toBeTruthy();
  expect(tab).not.toHaveBeenCalled();
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: '重试' })); });
  expect(send.mock.calls.map(([input]) => input.action)).toEqual([
    expect.objectContaining({ key: 'Shift', event: 'down' }),
    expect.objectContaining({ key: 'Shift', event: 'up' }),
    expect.objectContaining({ key: 'Shift', event: 'up' }),
  ]);
  expect(send.mock.calls.every(([input]) => input.tabId === 'tab-1')).toBe(true);
  expect(send.mock.calls[2]?.[0]).toEqual(send.mock.calls[1]?.[0]);
  await act(async () => { fireEvent.click(screen.getByRole('tab', { name: '第二页' })); });
  expect(tab).toHaveBeenCalledTimes(1);
});

it('pressed keys still release after later input error; cancelled unsent keydown skips keyup', async () => {
  const app = await renderApp({ hash: '#/browser', setup(fake) { fake.control.toolGroups.browser.seed(twoTabs); } });
  act(() => app.control.toolGroups.browser.emitFrame(frame(1)));
  const keyboard = screen.getByRole('textbox', { name: '浏览器键盘输入' });
  await act(async () => { fireEvent.keyDown(keyboard, { key: 'Control', code: 'ControlLeft', ctrlKey: true }); });
  let release: (() => void) | undefined;
  const send = vi.spyOn(app.api.browser, 'act').mockImplementationOnce(async () => {
    await new Promise<void>((resolve) => { release = resolve; });
    throw new Error('文字没有收到回执，请重试。');
  });
  await act(async () => { fireEvent.input(keyboard, { target: { value: '在途文字' } }); });
  try {
    fireEvent.keyDown(keyboard, { key: 'Shift', code: 'ShiftLeft', shiftKey: true });
  } finally {
    await act(async () => release?.());
  }
  expect(send.mock.calls.map(([input]) => input.action)).toEqual([
    { kind: 'type', text: '在途文字' }, expect.objectContaining({ key: 'Control', event: 'up' }),
  ]);
  expect(screen.getByText('文字没有收到回执，请重试。')).toBeTruthy();
});

it('re-pressing same key preserves prior failed release record so retry still cleans up', async () => {
  const app = await renderApp({ hash: '#/browser', setup(fake) { fake.control.toolGroups.browser.seed(twoTabs); } });
  act(() => app.control.toolGroups.browser.emitFrame(frame(1)));
  const original = app.api.browser.act.bind(app.api.browser);
  let release: (() => void) | undefined;
  let failed = false;
  const send = vi.spyOn(app.api.browser, 'act').mockImplementation(async (input) => {
    if (input.action.kind === 'key' && input.action.event === 'up' && !failed) {
      failed = true;
      await new Promise<void>((resolve) => { release = resolve; });
      throw new Error('松键没有收到回执，请重试。');
    }
    return original(input);
  });
  const keyboard = screen.getByRole('textbox', { name: '浏览器键盘输入' });
  await act(async () => { fireEvent.keyDown(keyboard, { key: 'Control', code: 'ControlLeft', ctrlKey: true }); });
  await act(async () => { fireEvent.keyUp(keyboard, { key: 'Control', code: 'ControlLeft' }); });
  try {
    fireEvent.keyDown(keyboard, { key: 'Control', code: 'ControlLeft', ctrlKey: true });
  } finally {
    await act(async () => release?.());
  }
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: '重试' })); });
  expect(send.mock.calls.map(([input]) => input.action)).toEqual([
    expect.objectContaining({ key: 'Control', event: 'down' }),
    expect.objectContaining({ key: 'Control', event: 'up' }),
    expect.objectContaining({ key: 'Control', event: 'up' }),
  ]);
  expect(app.control.toolGroups.browser.actions.at(-1)).toMatchObject({ key: 'Control', event: 'up' });
});

it('remote-initiated tab switch still releases keys on old tab and allows switching back', async () => {
  const app = await renderApp({ hash: '#/browser', setup(fake) { fake.control.toolGroups.browser.seed(twoTabs); } });
  act(() => app.control.toolGroups.browser.emitFrame(frame(1)));
  const send = vi.spyOn(app.api.browser, 'act');
  const keyboard = screen.getByRole('textbox', { name: '浏览器键盘输入' });
  await act(async () => { fireEvent.keyDown(keyboard, { key: 'Control', code: 'ControlLeft', ctrlKey: true }); });
  await act(async () => app.control.toolGroups.browser.seed({ activeTabId: 'tab-2' }));
  expect(app.control.toolGroups.browser.actions.at(-1)).toMatchObject({ key: 'Control', event: 'up' });
  expect(send.mock.calls.map(([input]) => input.tabId)).toEqual(['tab-1', 'tab-1']);
  expect(screen.getByRole('tab', { name: '第二页' }).getAttribute('aria-selected')).toBe('true');
  await act(async () => { fireEvent.click(screen.getByRole('tab', { name: '第一页' })); });
  expect(screen.getByRole('tab', { name: '第一页' }).getAttribute('aria-selected')).toBe('true');
});

it('tab switch pauses old-frame input immediately until switch completes and new frame arrives', async () => {
  const app = await renderApp({ hash: '#/browser', setup(fake) { fake.control.toolGroups.browser.seed(twoTabs); } });
  act(() => app.control.toolGroups.browser.emitFrame(frame(1)));
  const original = app.api.browser.tab.bind(app.api.browser);
  let release: (() => void) | undefined;
  vi.spyOn(app.api.browser, 'tab').mockImplementation(async (input) => {
    await new Promise<void>((resolve) => { release = resolve; });
    return original(input);
  });
  const send = vi.spyOn(app.api.browser, 'act');
  const surface = screen.getByRole('group', { name: '浏览器画面' });
  const tap = (): void => {
    touch(surface, 'pointerdown', 20, 30);
    touch(surface, 'pointerup', 20, 30);
  };
  await act(async () => { fireEvent.click(screen.getByRole('tab', { name: '第二页' })); });
  try {
    await act(async () => {
      tap();
      fireEvent.input(screen.getByRole('textbox', { name: '浏览器键盘输入' }), { target: { value: '旧页输入' } });
    });
  } finally {
    await act(async () => release?.());
  }
  expect(send).not.toHaveBeenCalled();
  tap();
  expect(send).not.toHaveBeenCalled();
  act(() => app.control.toolGroups.browser.emitFrame({ ...frame(2), tabId: 'tab-2' }));
  await act(async () => tap());
  expect(send).toHaveBeenCalledWith(expect.objectContaining({ tabId: 'tab-2' }));
});

it('queued inputs retain origin tab so state switch never routes old clicks to new tab', async () => {
  const app = await renderApp({ hash: '#/browser', setup(fake) { fake.control.toolGroups.browser.seed(twoTabs); } });
  act(() => app.control.toolGroups.browser.emitFrame(frame(1)));
  let release: (() => void) | undefined;
  const send = vi.spyOn(app.api.browser, 'act').mockImplementationOnce(async () => {
    await new Promise<void>((resolve) => { release = resolve; });
    return { browser: await app.api.browser.get(), outcome: 'done' };
  });
  const keyboard = screen.getByRole('textbox', { name: '浏览器键盘输入' });
  await act(async () => { fireEvent.input(keyboard, { target: { value: '第一段' } }); });
  fireEvent.input(keyboard, { target: { value: '第二段' } });
  act(() => app.control.toolGroups.browser.seed({ activeTabId: 'tab-2' }));
  await act(async () => release?.());
  expect(send.mock.calls.map(([input]) => input.tabId)).toEqual(['tab-1', 'tab-1']);
});

it('request cache rotation does not cancel in-flight decode or reset stream sequence', async () => {
  const images: { onload: (() => void) | null; width: number; height: number; src: string }[] = [];
  vi.stubGlobal('Image', class {
    onload: (() => void) | null = null;
    width = 1280;
    height = 800;
    src = '';
    constructor() { images.push(this); }
  });
  const draw = vi.fn();
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage: draw } as unknown as
    CanvasRenderingContext2D);
  const app = await renderApp({ hash: '#/browser', setup(fake) { fake.control.toolGroups.browser.seed(twoTabs); } });
  act(() => app.control.toolGroups.browser.emitFrame(frame(3)));
  act(() => app.control.toolGroups.browser.seed({ instanceId: 'next-request-cache' }));
  act(() => images[0]?.onload?.());
  await waitFor(() => expect(app.control.toolGroups.browser.acknowledgements).toEqual([3]));
  act(() => app.control.toolGroups.browser.emitFrame(frame(2)));
  expect(images.length).toBe(1);
  act(() => app.control.toolGroups.browser.emitFrame(frame(4)));
  act(() => images[1]?.onload?.());
  await waitFor(() => expect(app.control.toolGroups.browser.acknowledgements).toEqual([3, 4]));
});

it('keeps input paused while new tab frame awaits draw and resumes only after draw ack', async () => {
  const images: { onload: (() => void) | null }[] = [];
  vi.stubGlobal('Image', class {
    onload: (() => void) | null = null;
    width = 1280;
    height = 800;
    src = '';
    constructor() { images.push(this); }
  });
  const app = await renderApp({ hash: '#/browser', setup(fake) { fake.control.toolGroups.browser.seed(twoTabs); } });
  act(() => app.control.toolGroups.browser.emitFrame(frame(1)));
  act(() => images[0]?.onload?.());
  await act(async () => { fireEvent.click(screen.getByRole('tab', { name: '第二页' })); });
  act(() => app.control.toolGroups.browser.emitFrame({ ...frame(2), tabId: 'tab-2' }));
  const surface = screen.getByRole('group', { name: '浏览器画面' });
  const send = vi.spyOn(app.api.browser, 'act');
  const tap = (): void => {
    touch(surface, 'pointerdown', 20, 30);
    touch(surface, 'pointerup', 20, 30);
  };
  await act(async () => tap());
  expect(send).not.toHaveBeenCalled();
  act(() => images[1]?.onload?.());
  await act(async () => tap());
  expect(send).toHaveBeenCalledWith(expect.objectContaining({ tabId: 'tab-2' }));
});

it('enables soft keyboard only after click ack confirms remote edit focus; toolbar can toggle', async () => {
  const app = await renderApp({ hash: '#/browser', setup(fake) { fake.control.toolGroups.browser.seed(twoTabs); } });
  act(() => app.control.toolGroups.browser.emitFrame(frame(1)));
  let release: (() => void) | undefined;
  vi.spyOn(app.api.browser, 'act').mockImplementation(async () => {
    await new Promise<void>((resolve) => { release = resolve; });
    return { browser: { ...await app.api.browser.get(), editableFocused: true }, outcome: 'done' };
  });
  const surface = screen.getByRole('group', { name: '浏览器画面' });
  const keyboard = screen.getByRole('textbox', { name: '浏览器键盘输入' });
  await act(async () => {
    touch(surface, 'pointerdown', 20, 30);
    touch(surface, 'pointerup', 20, 30);
  });
  const focusedBeforeReply = document.activeElement === keyboard;
  await act(async () => release?.());
  expect(focusedBeforeReply).toBe(false);
  expect(document.activeElement).toBe(keyboard);
  act(() => keyboard.blur());
  fireEvent.click(screen.getByRole('button', { name: '键盘' }));
  expect(document.activeElement).toBe(keyboard);
});

it('navigation updates URL bar keeping focus draft until blur; loading swaps Reload for Stop', async () => {
  const app = await renderApp({ hash: '#/browser', setup(fake) {
    fake.control.toolGroups.browser.seed({ open: true, url: 'https://example.com/', activeTabId: 'tab-1' });
  } });
  const address = await screen.findByRole('textbox', { name: '地址栏' });
  act(() => app.control.toolGroups.browser.seed({ url: 'https://example.com/redirect', loading: true }));
  expect((address as HTMLInputElement).value).toBe('https://example.com/redirect');
  fireEvent.click(screen.getByRole('button', { name: '停止加载' }));
  await waitFor(() => expect(app.control.toolGroups.browser.actions).toContainEqual({ kind: 'stop' }));
  act(() => app.control.toolGroups.browser.emitFrame(frame(1)));
  const surface = screen.getByRole('group', { name: '浏览器画面' });
  touch(surface, 'pointerdown', 50, 50);
  touch(surface, 'pointerup', 50, 50);
  act(() => address.focus());
  expect(document.activeElement).toBe(address);
  fireEvent.change(address, { target: { value: 'https://draft.example/' } });
  act(() => app.control.toolGroups.browser.seed({ url: 'https://example.com/last', loading: false }));
  expect((address as HTMLInputElement).value).toBe('https://draft.example/');
  fireEvent.blur(address);
  expect((address as HTMLInputElement).value).toBe('https://example.com/last');
  expect(screen.getByRole('button', { name: '刷新' })).toBeTruthy();
});

it('sends initial viewport size and DPR; debounces resize 300ms before replacing watch stream', async () => {
  let resize: ResizeObserverCallback | undefined;
  let element: Element | undefined;
  const disconnect = vi.fn();
  vi.stubGlobal('ResizeObserver', class {
    private readonly callback: ResizeObserverCallback;
    constructor(callback: ResizeObserverCallback) { this.callback = callback; }
    observe(target: Element) {
      if (target.closest('.line-scroll') !== null) return;
      resize = this.callback;
      element = target;
    }
    disconnect = disconnect;
  });
  vi.stubGlobal('devicePixelRatio', 3);
  const app = await renderApp({ hash: '#/browser' });
  const stream = vi.spyOn(app.api.browser, 'stream');
  const notify = (width: number, height: number): void => {
    resize?.([{ target: element, contentRect: { width, height } } as ResizeObserverEntry], {} as ResizeObserver);
  };
  vi.useFakeTimers();
  try {
    act(() => notify(390, 700));
    expect(stream).toHaveBeenCalledTimes(1);
    expect(stream.mock.calls[0]?.[0]).toMatchObject({ width: 390, height: 700, deviceScaleFactor: 2 });
    act(() => notify(400, 650));
    act(() => vi.advanceTimersByTime(200));
    act(() => notify(420, 640));
    act(() => vi.advanceTimersByTime(299));
    expect(stream).toHaveBeenCalledTimes(1);
    act(() => vi.advanceTimersByTime(1));
    expect(stream).toHaveBeenCalledTimes(2);
    expect(stream.mock.calls[1]?.[0]).toMatchObject({ width: 420, height: 640, deviceScaleFactor: 2 });
    app.view.unmount();
    expect(disconnect).toHaveBeenCalled();
  } finally {
    vi.useRealTimers();
  }
});

it('Stop button dispatches immediately during pending navigation without queueing behind it', async () => {
  const app = await renderApp({ hash: '#/browser', setup(fake) {
    fake.control.toolGroups.browser.seed({ open: true, activeTabId: 'tab-1', url: 'https://example.com/' });
  } });
  let release: (() => void) | undefined;
  vi.spyOn(app.api.browser, 'open').mockImplementation(async () => {
    await new Promise<void>((resolve) => { release = resolve; });
    return app.api.browser.get();
  });
  const address = screen.getByRole('textbox', { name: '地址栏' });
  fireEvent.change(address, { target: { value: 'https://example.com/slow' } });
  await act(async () => { fireEvent.keyDown(address, { key: 'Enter' }); });
  act(() => app.control.toolGroups.browser.seed({ loading: true }));
  try {
    fireEvent.click(screen.getByRole('button', { name: '停止加载' }));
    await waitFor(() => expect(app.control.toolGroups.browser.actions).toContainEqual({ kind: 'stop' }));
  } finally {
    await act(async () => release?.());
  }
});

it.each([1440])('%s 宽：浏览器页顶部有「浏览器 · 返回」小页头，返回回到进来前那一页，空态和地址栏一样留边', async (width) => {
  await renderApp({ width, hash: '#/notes' });
  act(() => {
    window.location.hash = '#/browser';
    window.dispatchEvent(new HashChangeEvent('hashchange'));
  });
  const head = await screen.findByRole('banner', { name: '浏览器页头' });
  expect(head.textContent).toContain('浏览器');
  expect(screen.getAllByRole('button', { name: '返回' })).toHaveLength(1);
  const empty = screen.getByText('打开一个网址，或新开标签页。');
  expect(empty.classList.contains('browser-empty')).toBe(true);
  const sheet = new CSSStyleSheet();
  sheet.replaceSync(browserCss);
  const rules = [...sheet.cssRules].filter((rule): rule is CSSStyleRule => rule instanceof CSSStyleRule);
  const bar = rules.find((rule) => rule.selectorText === '.browser-tool > :not(.browser-viewport)');
  const padded = rules.find((rule) => rule.selectorText === '.browser-viewport > .browser-empty');
  expect(padded?.style.padding).toBe(bar?.style.padding);
  fireEvent.click(screen.getByRole('button', { name: '返回' }));
  await waitFor(() => expect(window.location.hash).toBe('#/notes'));
});
