import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cdpMouseEvent } from '../src/tabs/tab-input.ts';

const ORIGIN = { x: 324, y: 100 };

test('maps press, release, and move to CDP mouse events in tab-local coordinates', () => {
  assert.deepEqual(cdpMouseEvent({ type: 'mouseDown', x: 400, y: 150, button: 'left', clickCount: 2,
    modifiers: ['shift', 'meta', 'leftButtonDown'] }, ORIGIN), { type: 'mousePressed', x: 76, y: 50,
    button: 'left', buttons: 1, clickCount: 2, modifiers: 12 });
  assert.deepEqual(cdpMouseEvent({ type: 'mouseUp', x: 324, y: 100, button: 'right', clickCount: 1,
    modifiers: ['control', 'alt'] }, ORIGIN), { type: 'mouseReleased', x: 0, y: 0, button: 'right', buttons: 0,
    clickCount: 1, modifiers: 3 });
});

test('includes held button during left-drag move and sets button none when unpressed', () => {
  assert.deepEqual(cdpMouseEvent({ type: 'mouseMove', x: 500, y: 300, button: 'left', clickCount: 1,
    modifiers: ['leftButtonDown'] }, ORIGIN), { type: 'mouseMoved', x: 176, y: 200, button: 'left', buttons: 1,
    clickCount: 0, modifiers: 0 });
  assert.deepEqual(cdpMouseEvent({ type: 'mouseMove', x: 500, y: 300, modifiers: [] }, ORIGIN),
    { type: 'mouseMoved', x: 176, y: 200, button: 'none', buttons: 0, clickCount: 0, modifiers: 0 });
});

test('excludes wheel and unknown events from CDP (wheel stays on sendInputEvent)', () => {
  assert.equal(cdpMouseEvent({ type: 'mouseWheel', x: 500, y: 300, modifiers: [], deltaY: -40 }, ORIGIN), null);
  assert.equal(cdpMouseEvent({ type: 'mouseEnter', x: 500, y: 300, modifiers: [] }, ORIGIN), null);
});
