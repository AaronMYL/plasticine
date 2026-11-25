import { afterEach, describe, expect, it, vi } from 'vitest';
import { byText, click, Missed, setPaused, sleep, Stopped, typeInto, waitFor,
  type Stage } from '../../src/demo/stage.ts';

const alive: Stage = { alive: () => true };

afterEach(() => {
  vi.useRealTimers();
  document.body.replaceChildren();
});

describe('demo helper utilities', () => {
  it('changing scenes stops awaiting wakeup', async () => {
    let on = true;
    const waiting = sleep({ alive: () => on }, 5);
    on = false;
    await expect(waiting).rejects.toBeInstanceOf(Stopped);
  });

  it('pauses execution while paused and resumes when unpaused', async () => {
    setPaused(true);
    let done = false;
    const waiting = sleep(alive, 1).then(() => { done = true; });
    await new Promise((resolve) => setTimeout(resolve, 260));
    expect(done).toBe(false);
    setPaused(false);
    await waiting;
    expect(done).toBe(true);
  });

  it('element never appearing counts as missed, not paused', async () => {
    await expect(waitFor(alive, () => null, 10)).rejects.toBeInstanceOf(Missed);
    await expect(waitFor(alive, () => 'x', 10)).resolves.toBe('x');
  });

  it('finds visible button by text prefix, moves fake cursor over it, and clicks', async () => {
    const button = document.createElement('button');
    button.textContent = '分工 3';
    Object.defineProperty(button, 'offsetParent', { get: () => document.body });
    const pressed = vi.fn();
    button.addEventListener('click', pressed);
    document.body.append(button);
    expect(byText('分工')).toBe(button);
    expect(byText('没有')).toBeNull();
    await click(alive, button);
    expect(pressed).toHaveBeenCalledOnce();
    expect(document.querySelector('.demo-cursor')?.getAttribute('data-shown')).toBe('true');
  });

  it('types into input character by character', async () => {
    const typed: string[] = [];
    document.execCommand = vi.fn((_command: string, _ui?: boolean, value?: string) => {
      typed.push(value ?? '');
      return true;
    });
    const box = document.createElement('textarea');
    document.body.append(box);
    await typeInto(alive, box, '排一下', 0);
    expect(typed).toEqual(['排', '一', '下']);
    expect(document.activeElement).toBe(box);
  });
});
