import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { banner, dropThemeImports, ENGINE_EXPORTS, entrySource, VENDOR_DIR } from './vendor-plasticine-bot.ts';

test('入口只导出界面用到的几样', () => {
  assert.equal(entrySource('/x/dist/index.js'),
    `export { ${ENGINE_EXPORTS.join(', ')} } from "/x/dist/index.js";\n`);
});

test('节日主题的按需分包换成直接失败', () => {
  const code = 'a=()=>import("@plasticine-bot/engine/themes/mid-autumn"),b=()=>import(\'./local.js\')';
  const out = dropThemeImports(code);
  assert.doesNotMatch(out, /engine\/themes/);
  assert.match(out, /Promise\.reject/);
  assert.match(out, /import\('\.\/local\.js'\)/);
});

test('文件头写构建提交和许可，不写私有仓库名', () => {
  const head = banner('6ec6e328cac6efc7bd73e29e4c4e2738c63fa2f2');
  assert.match(head, /6ec6e328/);
  assert.match(head, /MIT/);
  assert.doesNotMatch(head, /AaronMYL|github/i);
});

test('打包好的引擎导出的正是清单里的几样，类型文件都写了', async () => {
  const engine = await import(join(VENDOR_DIR, 'engine.js')) as Record<string, unknown>;
  assert.deepEqual(Object.keys(engine).sort(), [...ENGINE_EXPORTS].sort());
  const types = readFileSync(join(VENDOR_DIR, 'engine.d.ts'), 'utf8');
  for (const name of ENGINE_EXPORTS) {
    assert.match(types, new RegExp(`export (function|const) ${name}\\b`), name);
  }
  assert.match(readFileSync(join(VENDOR_DIR, 'LICENSE'), 'utf8'), /MIT License/);
  assert.doesNotMatch(readFileSync(join(VENDOR_DIR, 'engine.js'), 'utf8'), /\bimport\(/);
});
