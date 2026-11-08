import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Script } from 'node:vm';
import { generate, swiftSource, TARGETS, translateScript } from './generate-translate-script.ts';

test('Mac 里注入的翻译脚本是最新的：去掉类型后能直接跑，几份之间不留 import / export', () => {
  assert.doesNotThrow(() => generate(true));
  const script = translateScript();
  assert.doesNotThrow(() => new Script(script));
  assert.doesNotMatch(script, /^\s*(?:import|export)\s/m);
  assert.match(script, /^\(\(\) => \{\nif \(window\.__plasticineTranslator\) return;/);
  assert.match(script, /messageHandlers\.plasticineTranslatePage\.postMessage/);
  assert.match(swiftSource(), /^enum TranslatePageScript \{\n {4}static let source = #"""\n/m);
});

test('只生成 Mac 那一份（iPhone 那份随 ios/ 2026-11-05 删掉）', () => {
  assert.equal(TARGETS.length, 1);
  assert.match(TARGETS[0]!.url.pathname, /\/mac\/Sources\/Plasticine\/translate-page-script\.swift$/);
});
