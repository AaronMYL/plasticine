// 手机笔记键盘上方的 AI 行（11-13）：键盘占了多高按 visualViewport 算；没弹起来是 0。

import { describe, expect, it } from 'vitest';
import { keyboardInset } from '../../../src/views/notes/use-keyboard-inset.ts';

describe('键盘占的高度', () => {
  it('键盘收着是 0；弹起来是窗口高减去看得见的那一块；页面被顶上去的部分不算', () => {
    expect(keyboardInset({ height: 844, offsetTop: 0 }, 844)).toBe(0);
    expect(keyboardInset({ height: 508, offsetTop: 0 }, 844)).toBe(336);
    expect(keyboardInset({ height: 508, offsetTop: 120 }, 844)).toBe(216);
    expect(keyboardInset({ height: 900, offsetTop: 0 }, 844)).toBe(0);
  });
});
