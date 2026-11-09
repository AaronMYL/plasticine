import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cdpMouseEvent } from '../src/tabs/tab-input.ts';

const ORIGIN = { x: 324, y: 100 };

test('按下、抬起、移动换成调试协议的鼠标事件，坐标换成标签自己的', () => {
  assert.deepEqual(cdpMouseEvent({ type: 'mouseDown', x: 400, y: 150, button: 'left', clickCount: 2,
    modifiers: ['shift', 'meta', 'leftButtonDown'] }, ORIGIN), { type: 'mousePressed', x: 76, y: 50,
    button: 'left', buttons: 1, clickCount: 2, modifiers: 12 });
  assert.deepEqual(cdpMouseEvent({ type: 'mouseUp', x: 324, y: 100, button: 'right', clickCount: 1,
    modifiers: ['control', 'alt'] }, ORIGIN), { type: 'mouseReleased', x: 0, y: 0, button: 'right', buttons: 0,
    clickCount: 1, modifiers: 3 });
});

test('移动：拖着左键时带上按住的键（拖选文字），没按键时 button 是 none', () => {
  assert.deepEqual(cdpMouseEvent({ type: 'mouseMove', x: 500, y: 300, button: 'left', clickCount: 1,
    modifiers: ['leftButtonDown'] }, ORIGIN), { type: 'mouseMoved', x: 176, y: 200, button: 'left', buttons: 1,
    clickCount: 0, modifiers: 0 });
  assert.deepEqual(cdpMouseEvent({ type: 'mouseMove', x: 500, y: 300, modifiers: [] }, ORIGIN),
    { type: 'mouseMoved', x: 176, y: 200, button: 'none', buttons: 0, clickCount: 0, modifiers: 0 });
});

test('滚轮和认不得的事件不走调试协议（滚轮照旧 sendInputEvent）', () => {
  assert.equal(cdpMouseEvent({ type: 'mouseWheel', x: 500, y: 300, modifiers: [], deltaY: -40 }, ORIGIN), null);
  assert.equal(cdpMouseEvent({ type: 'mouseEnter', x: 500, y: 300, modifiers: [] }, ORIGIN), null);
});
