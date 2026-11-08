import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { test } from 'node:test';
import { checkTokens, parseDiff } from '../../src/system/index.ts';

const REPO = join(import.meta.dirname, '..', '..', '..');

/** 把几行当成某个文件新增的内容，拼成一份 unified diff。 */
function addedDiff(path: string, lines: readonly string[]): string {
  const body = lines.map((line) => `+${line}`).join('\n');
  return `diff --git a/${path} b/${path}\n--- a/${path}\n+++ b/${path}\n@@ -0,0 +1,${lines.length} @@\n${body}\n`;
}

test('只在令牌之间换用的界面改动过得了检查器：var(--令牌)、字阶里的字号、描边环和 --lift', () => {
  const diff = addedDiff('client/src/views/device/device.css', [
    '.device-row {',
    '  color: var(--fg2);',
    '  font-size: 13px;',
    '  box-shadow: inset 0 0 0 1px var(--line2);',
    '  background: transparent;',
    '}',
    '.device-sheet { box-shadow: var(--lift); }',
    '/* 强调色 #CC7D5E 只做点（注释里写色值不算） */',
  ]);
  assert.deepEqual(checkTokens(parseDiff(diff)), []);
});

test('令牌表外的颜色、阴影、字号都不过，指出文件和行', () => {
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

test('tsx 里现写的颜色和字号也不过；class 名和文案的改动不算', () => {
  const diff = addedDiff('client/src/views/device/device-page.tsx', [
    '<p className="device-note">配对一台新设备</p>',
    '<span style={{ color: \'#fff\', fontSize: 18 }}>x</span>',
  ]);
  const found = checkTokens(parseDiff(diff));
  assert.deepEqual(found.map((violation) => violation.kind).sort(), ['color', 'font_size']);
});

test('图书的四色高亮和阅读字号令牌（第 100 条）可以用；阅读字号只能就地改这两个，别的变量照样算新令牌', () => {
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

test('第 102 条视觉放开：类别色令牌和卡片色变量能用，单边细线和顶边色条（inset、不模糊）能用；现写颜色、浮影仍不过', () => {
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

test('改 tokens.css 是改令牌的值，在别处定义新的 --变量 是新令牌', () => {
  const tokens = addedDiff('client/src/tokens.css', ['  --accent: #d0805f;']);
  const fresh = addedDiff('client/src/views/x.css', [':root { --brand: var(--fg); }']);
  const found = checkTokens(parseDiff(`${tokens}${fresh}`));
  assert.equal(found[0]?.kind, 'token_value');
  assert.match(found[0]?.text ?? '', /^改令牌：/);
  assert.equal(found[1]?.kind, 'token_value');
  assert.match(found[1]?.text ?? '', /^新令牌 --brand/);
});

async function styledFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true, recursive: true });
  return entries
    .filter((entry) => entry.isFile() && /\.(?:css|tsx)$/.test(entry.name))
    .map((entry) => join(entry.parentPath, entry.name));
}

test('现有界面整份当成新增也过得了检查器（规则和方向 I 的现状对得上，tokens.css 除外）', async () => {
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
