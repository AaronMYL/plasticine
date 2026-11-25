import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isPopupRequest, popupBounds, popupSize } from '../src/tabs/tab-popup.ts';

const GIS_FEATURES = 'toolbar=no,location=no,directories=no,status=no,menubar=no,scrollbars=no,resizable=no,'
  + 'copyhistory=no,width=590,height=830,top=35,left=345';

test('opens window.open with explicit dimensions (login popup) as a real popup window', () => {
  assert.equal(isPopupRequest({ url: 'https://accounts.google.com/gsi/select', disposition: 'new-window',
    features: GIS_FEATURES }), true);
  assert.equal(isPopupRequest({ url: 'https://example.com/', disposition: 'default', features: 'width=400' }), true);
  assert.equal(isPopupRequest({ url: 'about:blank', disposition: 'new-window', features: 'popup' }), true);
});

test('opens target=_blank, bare window.open, and Shift-click links as regular tabs', () => {
  assert.equal(isPopupRequest({ url: 'https://example.com/', disposition: 'foreground-tab', features: '' }), false);
  assert.equal(isPopupRequest({ url: 'https://example.com/', disposition: 'background-tab', features: '' }), false);
  assert.equal(isPopupRequest({ url: 'https://example.com/', disposition: 'new-window', features: '' }), false);
  assert.equal(isPopupRequest({ url: 'https://example.com/', disposition: 'foreground-tab',
    features: 'noopener,noreferrer' }), false);
});

test('blocks popup windows for URLs other than http(s) and about:blank', () => {
  assert.equal(isPopupRequest({ url: 'mailto:a@example.com', disposition: 'new-window', features: 'width=400' }),
    false);
  assert.equal(isPopupRequest({ url: 'file:///etc/hosts', disposition: 'new-window', features: 'width=400' }), false);
});

test('parses popup dimensions from width/height and innerWidth/innerHeight features', () => {
  assert.deepEqual(popupSize(GIS_FEATURES), { width: 590, height: 830 });
  assert.deepEqual(popupSize('innerWidth=300, innerHeight = 200'), { width: 300, height: 200 });
  assert.deepEqual(popupSize('popup'), { width: null, height: null });
});

test('centers popup on main window using default size, clamping to min and screen bounds', () => {
  const parent = { x: 100, y: 50, width: 1440, height: 900 };
  const screen = { x: 0, y: 25, width: 1728, height: 1092 };
  assert.deepEqual(popupBounds({ width: 590, height: 830 }, parent, screen), { x: 525, y: 85, width: 590,
    height: 830 });
  assert.deepEqual(popupBounds({ width: null, height: null }, parent, screen), { x: 570, y: 200, width: 500,
    height: 600 });
  assert.deepEqual(popupBounds({ width: 20, height: 3000 }, parent, screen), { x: 770, y: 25, width: 100,
    height: 1092 });
  assert.deepEqual(popupBounds({ width: 600, height: 400 }, { x: 1500, y: 50, width: 800, height: 600 }, screen),
    { x: 1128, y: 150, width: 600, height: 400 });
});
