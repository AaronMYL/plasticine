import assert from 'node:assert/strict';
import { test } from 'node:test';
import { KeyRefused, keyStroke } from '../src/tabs/key-spec.ts';

test('maps keys to CDP format: Esc, Shift+Tab, space types char, modified letters omit text', () => {
  assert.deepEqual(keyStroke('Escape', 'darwin'), { key: 'Escape', code: 'Escape', keyCode: 27, modifiers: 0, text: '',
    commands: [] });
  assert.deepEqual(keyStroke('Shift+Tab', 'win32'), { key: 'Tab', code: 'Tab', keyCode: 9, modifiers: 8, text: '',
    commands: [] });
  assert.equal(keyStroke('Space', 'darwin').text, ' ');
  assert.deepEqual(keyStroke('a', 'linux'), { key: 'a', code: 'KeyA', keyCode: 65, modifiers: 0, text: 'a',
    commands: [] });
  assert.equal(keyStroke('Shift+b', 'linux').key, 'B');
  assert.equal(keyStroke('Control+5', 'linux').text, '');
  assert.equal(keyStroke('Control+5', 'linux').code, 'Digit5');
});

test('attaches Mac editing commands for Cmd+A, Cmd+Z, Shift+Cmd+Z only on macOS', () => {
  assert.deepEqual(keyStroke('Meta+A', 'darwin').commands, ['selectAll']);
  assert.deepEqual(keyStroke('Meta+z', 'darwin').commands, ['undo']);
  assert.deepEqual(keyStroke('Shift+Meta+z', 'darwin').commands, ['redo']);
  assert.deepEqual(keyStroke('Control+a', 'win32').commands, []);
});

test('ignores clipboard shortcuts and unrecognized keys', () => {
  for (const key of ['Meta+c', 'Meta+V', 'Control+x', 'Control+Shift+v']) {
    assert.throws(() => keyStroke(key, 'darwin'), KeyRefused, key);
  }
  assert.throws(() => keyStroke('Hyper+a', 'darwin'), KeyRefused);
  assert.throws(() => keyStroke('Enter', 'darwin'), KeyRefused);
});
