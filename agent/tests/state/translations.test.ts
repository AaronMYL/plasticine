import assert from 'node:assert/strict';
import { test } from 'node:test';
import { openState } from '../../src/state/index.ts';
import { openTestState, steppingClock, throwsState } from './helpers.ts';

const HASH_A = 'a'.repeat(64);
const HASH_B = 'b'.repeat(64);

test('翻译设置：没存过是默认值（中文、双语对照、用词表开、没有总是翻译的网站），版本对不上不覆盖，重开库还在', async () => {
  const t = await openTestState();
  try {
    const initial = t.state.translateSettings.get();
    assert.equal(initial.version, 0);
    assert.equal(initial.target, 'zh-CN');
    assert.equal(initial.display, 'bilingual');
    assert.equal(initial.glossary, true);
    assert.deepEqual(initial.alwaysSites, []);
    const saved = t.state.translateSettings.set(0, { target: 'ja', display: 'translation', glossary: false,
      alwaysSites: ['x.com', 'field-notes.dev'] });
    assert.equal(saved.version, 1);
    throwsState(() => t.state.translateSettings.set(0, { target: 'en', display: 'bilingual', glossary: true,
      alwaysSites: [] }), 'version_conflict');
    t.close();
    const reopened = openState({ path: t.path, now: steppingClock() });
    try {
      const stored = reopened.translateSettings.get();
      assert.equal(stored.target, 'ja');
      assert.equal(stored.display, 'translation');
      assert.equal(stored.glossary, false);
      assert.deepEqual(stored.alwaysSites, ['x.com', 'field-notes.dev']);
      assert.equal(reopened.translateSettings.set(1, { ...stored, alwaysSites: [] }).version, 2);
    } finally {
      reopened.close();
    }
  } finally {
    await t.cleanup();
  }
});

test('译文缓存：按原文散列、目标语言、模型、词表散列分开；命中记一次用过，再存同一键覆盖成新译文', async () => {
  const t = await openTestState();
  try {
    const cache = t.state.translationCache;
    const key = { sourceHash: HASH_A, target: 'zh-CN' as const, model: 'gpt-6-luna', glossaryHash: '' };
    assert.equal(cache.lookup([key]).size, 0);
    cache.store([{ ...key, text: '第一版译文', sourceChars: 20 },
      { ...key, sourceHash: HASH_B, text: '另一段', sourceChars: 5 }]);
    const found = cache.lookup([key, { ...key, target: 'ja' }, { ...key, model: 'gpt-6-astra' },
      { ...key, glossaryHash: 'c'.repeat(64) }]);
    assert.equal(found.size, 1);
    assert.equal(found.get(cache.keyOf(key)), '第一版译文');
    cache.store([{ ...key, text: '重译后的', sourceChars: 20 }]);
    assert.equal(cache.lookup([key]).get(cache.keyOf(key)), '重译后的');
    assert.deepEqual(cache.stats(), { entries: 2, hits: 2 });
  } finally {
    await t.cleanup();
  }
});

test('译文缓存：一次查很多段也只按存过的回，空列表不查库', async () => {
  const t = await openTestState();
  try {
    const cache = t.state.translationCache;
    const keys = Array.from({ length: 300 }, (_, index) => ({
      sourceHash: index.toString(16).padStart(64, '0'), target: 'zh-CN' as const, model: 'm', glossaryHash: '',
    }));
    cache.store(keys.filter((_, index) => index % 3 === 0).map((key) => ({ ...key, text: key.sourceHash.slice(-3),
      sourceChars: 1 })));
    assert.equal(cache.lookup(keys).size, 100);
    assert.equal(cache.lookup([]).size, 0);
  } finally {
    await t.cleanup();
  }
});
