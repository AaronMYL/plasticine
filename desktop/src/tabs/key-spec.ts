import type { KeyStroke } from './cdp.ts';

const ALT = 1;
const CONTROL = 2;
const META = 4;
const SHIFT = 8;
const MODIFIER_BITS: Readonly<Record<string, number>> = { Alt: ALT, Control: CONTROL, Meta: META, Shift: SHIFT };

const NAMED: Readonly<Record<string, { key: string; code: string; keyCode: number; text?: string }>> = {
  Escape: { key: 'Escape', code: 'Escape', keyCode: 27 },
  Tab: { key: 'Tab', code: 'Tab', keyCode: 9 },
  ArrowUp: { key: 'ArrowUp', code: 'ArrowUp', keyCode: 38 },
  ArrowDown: { key: 'ArrowDown', code: 'ArrowDown', keyCode: 40 },
  ArrowLeft: { key: 'ArrowLeft', code: 'ArrowLeft', keyCode: 37 },
  ArrowRight: { key: 'ArrowRight', code: 'ArrowRight', keyCode: 39 },
  Home: { key: 'Home', code: 'Home', keyCode: 36 },
  End: { key: 'End', code: 'End', keyCode: 35 },
  PageUp: { key: 'PageUp', code: 'PageUp', keyCode: 33 },
  PageDown: { key: 'PageDown', code: 'PageDown', keyCode: 34 },
  Backspace: { key: 'Backspace', code: 'Backspace', keyCode: 8 },
  Delete: { key: 'Delete', code: 'Delete', keyCode: 46 },
  Space: { key: ' ', code: 'Space', keyCode: 32, text: ' ' },
};

const MAC_COMMANDS: Readonly<Record<string, string>> = { a: 'selectAll', z: 'undo' };
const CLIPBOARD_LETTERS = new Set(['c', 'x', 'v']);

export class KeyRefused extends Error {}

export function keyStroke(spec: string, platform: NodeJS.Platform): KeyStroke {
  const parts = spec.split('+');
  const name = parts.pop() ?? '';
  let modifiers = 0;
  for (const part of parts) {
    const bit = MODIFIER_BITS[part];
    if (bit === undefined) {
      throw new KeyRefused(`不认识的修饰键「${part}」：只有 Meta、Control、Alt、Shift。`);
    }
    modifiers |= bit;
  }
  const shift = (modifiers & SHIFT) !== 0;
  const command = (modifiers & (META | CONTROL | ALT)) !== 0;
  const named = NAMED[name];
  if (named !== undefined) {
    return { key: named.key, code: named.code, keyCode: named.keyCode, modifiers,
      text: command ? '' : named.text ?? '', commands: [] };
  }
  if (!/^[A-Za-z0-9]$/.test(name)) {
    throw new KeyRefused(`不认识的键「${name}」。`);
  }
  const lower = name.toLowerCase();
  const editing = (modifiers & (META | CONTROL)) !== 0;
  if (editing && CLIPBOARD_LETTERS.has(lower)) {
    throw new KeyRefused('复制、剪切、粘贴会碰他电脑的剪贴板，不按：粘贴用 tab_paste，读页面上的字用 tab_read。');
  }
  const digit = /[0-9]/.test(name);
  const code = digit ? `Digit${name}` : `Key${lower.toUpperCase()}`;
  const keyCode = digit ? name.charCodeAt(0) : lower.toUpperCase().charCodeAt(0);
  const key = shift && !digit ? lower.toUpperCase() : lower;
  const macCommand = platform === 'darwin' && (modifiers & META) !== 0 ? MAC_COMMANDS[lower] : undefined;
  const commands = macCommand === undefined ? [] : [shift && lower === 'z' ? 'redo' : macCommand];
  return { key, code, keyCode, modifiers, text: command ? '' : key, commands };
}
