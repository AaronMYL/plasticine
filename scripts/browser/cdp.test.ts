import assert from 'node:assert/strict';
import { test } from 'node:test';
import { detectBrowserBinary } from './cdp.ts';

test('detectBrowserBinary prefers configured path over auto-detected candidates', () => {
  const found = detectBrowserBinary('/custom/chrome', () => true);
  assert.equal(found, '/custom/chrome');
});

test('detectBrowserBinary finds macOS Google Chrome when present', () => {
  const macChrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  const found = detectBrowserBinary(undefined, (candidate) => candidate === macChrome);
  assert.equal(found, macChrome);
});

test('detectBrowserBinary returns undefined when no browser binary exists', () => {
  const found = detectBrowserBinary(undefined, () => false);
  assert.equal(found, undefined);
});
