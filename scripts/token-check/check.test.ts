import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { test } from 'node:test';
import { checkTokens } from './check.ts';
import { parseDiff } from './diff.ts';

const REPO = join(import.meta.dirname, '..', '..');

function addedDiff(path: string, lines: readonly string[], created = false): string {
  const head = created ? `--- /dev/null\n+++ b/${path}` : `--- a/${path}\n+++ b/${path}`;
  const body = lines.map((line) => `+${line}`).join('\n');
  return `diff --git a/${path} b/${path}\n${head}\n@@ -0,0 +1,${lines.length} @@\n${body}\n`;
}

test('accepts UI changes using registered tokens, type-scale font sizes, inset rings, and --lift', () => {
  const diff = addedDiff('client/src/views/device/device.css', [
    '.device-row {',
    '  color: var(--fg2);',
    '  font-size: 13px;',
    '  box-shadow: inset 0 0 0 1px var(--line2);',
    '  background: transparent;',
    '}',
    '.device-sheet { box-shadow: var(--lift); }',
    '/** Accent #CC7D5E inside comments is ignored. */',
  ]);
  assert.deepEqual(checkTokens(parseDiff(diff)), []);
});

test('rejects unregistered colors, shadows, and font sizes with file and line numbers', () => {
  const diff = addedDiff('client/src/views/device/device.css', [
    '.a { color: #ff0000; }',
    '.b { background: rgba(0, 0, 0, 0.1); }',
    '.c { border-color: red; }',
    '.d { box-shadow: 0 2px 4px var(--line); }',
    '.e { font-size: 17px; }',
    '.f { font-size: 1.1rem; }',
    '.g { color: var(--brand); }',
    '.h { filter: drop-shadow(0 0 2px var(--fg)); }',
  ]);
  const found = checkTokens(parseDiff(diff));
  assert.deepEqual(
    found.map((violation) => `${violation.kind}:${violation.line}`),
    ['color:1', 'color:2', 'color:3', 'shadow:4', 'font_size:5', 'font_size:6', 'color:7', 'shadow:8'],
  );
  assert.ok(found.every((violation) => violation.file === 'client/src/views/device/device.css'));
});

test('rejects inline colors and font sizes in TSX while allowing class names and copy', () => {
  const diff = addedDiff('client/src/views/device/device-page.tsx', [
    '<p className="device-note">配对一台新设备</p>',
    '<span style={{ color: \'#fff\', fontSize: 18 }}>x</span>',
  ]);
  const found = checkTokens(parseDiff(diff));
  assert.deepEqual(found.map((violation) => violation.kind).sort(), ['color', 'font_size']);
});

test('allows reader highlight and scale tokens while rejecting ad-hoc custom variables', () => {
  const diff = addedDiff('client/src/views/books/reader.css', [
    '.bk-hl { background: var(--hl-sage); }',
    '.bk-content { font-size: var(--read-size); line-height: var(--read-leading); }',
    '.bk-text { --read-size: 18px; }',
    '.bk-text { --bk-size: 18px; font-size: var(--bk-size); }',
  ]);
  const found = checkTokens(parseDiff(diff));
  assert.deepEqual(found.map((violation) => `${violation.kind}:${violation.line}`),
    ['color:4', 'token_value:4', 'font_size:4']);
});

test('allows category hue tokens and unblurred inset borders while rejecting literal colors and drop shadows', () => {
  const diff = addedDiff('client/src/views/home/home.css', [
    '.tile { color: var(--hue-ochre); background: color-mix(in srgb, var(--tile-hue) var(--hue-wash), transparent); }',
    '.card { box-shadow: inset 0 0 0 1px var(--line2), inset 0 2px 0 var(--card-hue); }',
    '.mine { box-shadow: inset 1px 0 0 var(--fg3); }',
    '.count { box-shadow: inset 0 0 0 1.6px currentColor; }',
    '.bad { color: var(--hue-neon); }',
    '.float { box-shadow: 0 2px 8px var(--card-hue); }',
    '.mix { background: color-mix(in srgb, #ff0000 20%, transparent); }',
  ]);
  const hue = addedDiff('client/src/shell/hue.tsx', ['  return `var(--hue-${hue})`;']);
  const found = checkTokens(parseDiff(`${diff}${hue}`));
  assert.deepEqual(found.map((violation) => `${violation.kind}:${violation.line}`),
    ['color:5', 'shadow:6', 'color:7']);
});

test('distinguishes edits to tokens.css from defining new custom properties elsewhere', () => {
  const tokens = addedDiff('client/src/tokens.css', ['  --accent: #d0805f;']);
  const fresh = addedDiff('client/src/views/x.css', [':root { --brand: var(--fg); }']);
  const found = checkTokens(parseDiff(`${tokens}${fresh}`));
  assert.equal(found[0]?.kind, 'token_value');
  assert.match(found[0]?.text ?? '', /^Modified token:/);
  assert.equal(found[1]?.kind, 'token_value');
  assert.match(found[1]?.text ?? '', /^New token --brand/);
});

async function styledFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true, recursive: true });
  return entries
    .filter((entry) => entry.isFile() && /\.(?:css|tsx)$/.test(entry.name))
    .map((entry) => join(entry.parentPath, entry.name));
}

test('passes when evaluating the entire existing client/src tree (excluding tokens.css)', async () => {
  const files = await styledFiles(join(REPO, 'client', 'src'));
  let diff = '';
  for (const file of files) {
    const path = relative(REPO, file).replaceAll('\\', '/');
    if (path === 'client/src/tokens.css') {
      continue;
    }
    const text = await readFile(file, 'utf8');
    diff += addedDiff(path, text.split('\n'));
  }
  assert.deepEqual(checkTokens(parseDiff(diff)), []);
});

test('restricts standalone landing-page tokens to views/site', () => {
  const approved = [
    '.ch { color: var(--ch-bg); }',
    '.ch-panel { box-shadow: var(--ch-shadow-panel); }',
    '.ch-h1 { font-size: var(--ch-size-hero); }',
  ];
  assert.deepEqual(checkTokens(parseDiff(addedDiff('client/src/views/site/site.css', approved))), []);
  const app = checkTokens(parseDiff(addedDiff('client/src/views/home/home.css', approved)));
  assert.ok(app.some((item) => item.kind === 'color'));
  assert.ok(app.some((item) => item.kind === 'shadow'));
  assert.ok(app.some((item) => item.kind === 'font_size'));
  const site = checkTokens(parseDiff(addedDiff('client/src/views/site/site.css', [
    '.ch { color: #ff0000; }',
    '.ch { color: var(--ch-unregistered); }',
    '.ch { font-size: var(--ch-size-unregistered); }',
    '.ch { box-shadow: var(--ch-shadow-unregistered); }',
    '.ch { font-size: 52px; }',
    '.ch { box-shadow: 0 8px 24px var(--ch-bg); }',
  ])));
  for (const line of [1, 2, 3, 4, 5, 6]) assert.ok(site.some((item) => item.line === line));
});

test('enforces numeric tokens for radius, spacing, line-height, z-index, and motion unless exempted', () => {
  const diff = addedDiff('client/src/views/device/device.css', [
    '.a { border-radius: 8px; }',
    '.b { padding: 10px 16px; }',
    '.c { gap: var(--space-2); margin: 0 calc(-1 * var(--space-4)); }',
    '.d { line-height: 22px; }',
    '.e { line-height: 1; z-index: var(--z-float); }',
    '.f { z-index: 60; }',
    '.g { transition: opacity 180ms ease-out; }',
    '.h { transition: opacity var(--motion-base) var(--ease-out);'
      + ' animation: spin var(--motion-spin) linear infinite; }',
    '.i { padding-bottom: 96px; } /* allow-exception: floating orb clearance */',
    '.j { border-radius: 50%; }',
    '.k { z-index: calc(var(--z-dialog) + 1); border-radius: var(--radius-lg) var(--radius-lg) 0 0; }',
    '.l { font-size: var(--text-body); line-height: var(--text-body-line); padding: 0; }',
  ]);
  const found = checkTokens(parseDiff(diff));
  assert.deepEqual(found.map((entry) => [entry.kind, entry.line]),
    [['number', 1], ['number', 2], ['number', 4], ['number', 6], ['number', 7], ['number', 10]]);
});
