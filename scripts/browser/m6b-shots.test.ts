import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import * as cloudTools from '../../agent/src/cloud-tools/index.ts';

async function source(): Promise<string> {
  return readFile(new URL('./m6b-shots.ts', import.meta.url), 'utf8');
}

test('浏览器截图计划覆盖四种尺寸的浅深色，脑占用作为额外第九张', async () => {
  const file = await source();
  // 截图计划是声明式字面量；只解析数据，不导入会启动 Chromium 的脚本。
  const literal = /const cases = (\[[\s\S]*?\n\s*\]);/.exec(file)?.[1];
  assert.ok(literal);
  const cases = JSON.parse(literal.replace(/(\w+):/g, '"$1":')
    .replace(/'([^']*)'/g, '"$1"').replace(/,(\s*[}\]])/g, '$1')) as Record<string, unknown>[];
  assert.equal(cases.length, 9);
  const actual = cases.filter((shot) => shot['brain'] === false)
    .map((shot) => `${shot['width']}x${shot['height']}:${shot['theme']}`).sort();
  const expected = ['1440x900', '768x1024', '500x500', '390x844']
    .flatMap((size) => ['light', 'dark'].map((theme) => `${size}:${theme}`)).sort();
  assert.deepEqual(actual, expected);
  assert.equal(cases.filter((shot) => shot['brain'] === true).length, 1);
});

test('截图脚本只通过云端工具公开入口使用浏览器和视口辅助能力', async () => {
  const file = await source();
  const imports = [...file.matchAll(/from ['"]([^'"]+)['"]/g)].map((match) => match[1] ?? '');
  assert.deepEqual(imports.filter((path) => path.includes('/src/cloud-tools/')),
    ['../../agent/src/cloud-tools/index.ts']);
  assert.ok('encodedSize' in cloudTools && typeof cloudTools.encodedSize === 'function');
  assert.deepEqual(cloudTools.encodedSize({ width: 1440, height: 900, deviceScaleFactor: 2 }),
    { maxWidth: 2000, maxHeight: 1250 });
});
