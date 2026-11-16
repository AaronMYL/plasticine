// 官网演示的小工具：换了一幕上一幕就停、等不到的东西算这一幕到此为止、假光标点得到按钮、能往输入框里打字。
import { afterEach, describe, expect, it, vi } from 'vitest';
import { byText, click, Missed, setPaused, sleep, Stopped, typeInto, waitFor,
  type Stage } from '../../src/demo/stage.ts';

const alive: Stage = { alive: () => true };

afterEach(() => {
  vi.useRealTimers();
  document.body.replaceChildren();
});

describe('演示的小工具', () => {
  it('换了一幕：等待醒来就停', async () => {
    let on = true;
    const waiting = sleep({ alive: () => on }, 5);
    on = false;
    await expect(waiting).rejects.toBeInstanceOf(Stopped);
  });

  it('停住的时候不往下走，放开了接着走', async () => {
    setPaused(true);
    let done = false;
    const waiting = sleep(alive, 1).then(() => { done = true; });
    await new Promise((resolve) => setTimeout(resolve, 260));
    expect(done).toBe(false);
    setPaused(false);
    await waiting;
    expect(done).toBe(true);
  });

  it('等的东西一直没出现：算错过，不算停', async () => {
    await expect(waitFor(alive, () => null, 10)).rejects.toBeInstanceOf(Missed);
    await expect(waitFor(alive, () => 'x', 10)).resolves.toBe('x');
  });

  it('按开头的字找看得见的按钮，假光标移过去点一下', async () => {
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

  it('往输入框里一个字一个字打', async () => {
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
