import { describe, expect, it } from 'vitest';
import { keyboardInset } from '../../../src/views/notes/use-keyboard-inset.ts';

describe('Keyboard occupied height', () => {
  it('returns 0 when closed and window height minus visual viewport height when open, ignoring scroll', () => {
    expect(keyboardInset({ height: 844, offsetTop: 0 }, 844)).toBe(0);
    expect(keyboardInset({ height: 508, offsetTop: 0 }, 844)).toBe(336);
    expect(keyboardInset({ height: 508, offsetTop: 120 }, 844)).toBe(216);
    expect(keyboardInset({ height: 900, offsetTop: 0 }, 844)).toBe(0);
  });
});
