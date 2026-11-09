import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isPopupRequest, popupBounds, popupSize } from '../src/tabs/tab-popup.ts';

/** X 上「用 Google 登录」点出来的那一次 window.open（11-09 实录）。 */
const GIS_FEATURES = 'toolbar=no,location=no,directories=no,status=no,menubar=no,scrollbars=no,resizable=no,'
  + 'copyhistory=no,width=590,height=830,top=35,left=345';

test('带窗口尺寸的 window.open（登录弹窗）开成真的小窗口', () => {
  assert.equal(isPopupRequest({ url: 'https://accounts.google.com/gsi/select', disposition: 'new-window',
    features: GIS_FEATURES }), true);
  assert.equal(isPopupRequest({ url: 'https://example.com/', disposition: 'default', features: 'width=400' }), true);
  // 先开空白弹窗、再由打开它的页面改地址（常见的 OAuth 写法）。
  assert.equal(isPopupRequest({ url: 'about:blank', disposition: 'new-window', features: 'popup' }), true);
});

test('target=_blank 链接、不带参数的 window.open、按住 Shift 点链接：照旧开成标签', () => {
  assert.equal(isPopupRequest({ url: 'https://example.com/', disposition: 'foreground-tab', features: '' }), false);
  assert.equal(isPopupRequest({ url: 'https://example.com/', disposition: 'background-tab', features: '' }), false);
  assert.equal(isPopupRequest({ url: 'https://example.com/', disposition: 'new-window', features: '' }), false);
  assert.equal(isPopupRequest({ url: 'https://example.com/', disposition: 'foreground-tab',
    features: 'noopener,noreferrer' }), false);
});

test('http(s) 和空白页以外的地址不开窗口', () => {
  assert.equal(isPopupRequest({ url: 'mailto:a@example.com', disposition: 'new-window', features: 'width=400' }),
    false);
  assert.equal(isPopupRequest({ url: 'file:///etc/hosts', disposition: 'new-window', features: 'width=400' }), false);
});

test('窗口尺寸照 features 读（width / height，也认 innerWidth / innerHeight）', () => {
  assert.deepEqual(popupSize(GIS_FEATURES), { width: 590, height: 830 });
  assert.deepEqual(popupSize('innerWidth=300, innerHeight = 200'), { width: 300, height: 200 });
  assert.deepEqual(popupSize('popup'), { width: null, height: null });
});

test('小窗口居中在主窗口上；没给大小用默认，太小抬到最小，太大压进屏幕', () => {
  const parent = { x: 100, y: 50, width: 1440, height: 900 };
  const screen = { x: 0, y: 25, width: 1728, height: 1092 };
  assert.deepEqual(popupBounds({ width: 590, height: 830 }, parent, screen), { x: 525, y: 85, width: 590,
    height: 830 });
  assert.deepEqual(popupBounds({ width: null, height: null }, parent, screen), { x: 570, y: 200, width: 500,
    height: 600 });
  assert.deepEqual(popupBounds({ width: 20, height: 3000 }, parent, screen), { x: 770, y: 25, width: 100,
    height: 1092 });
  // 主窗口一半在屏幕外：小窗口挪回屏幕里。
  assert.deepEqual(popupBounds({ width: 600, height: 400 }, { x: 1500, y: 50, width: 800, height: 600 }, screen),
    { x: 1128, y: 150, width: 600, height: 400 });
});
