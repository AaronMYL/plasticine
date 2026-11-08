// 记忆和技能在真服务端上读：引用里指向的一条单独读——整理前的推测（只读）、约定和词语（那一行和版本来路，撤下的标「已撤」）、
// 暂缓的词义提议不在词语详情里重新催答但能明确采纳、技能目录读方法正文（不显示元数据）。浏览不改任何资料、不调模型。
// 记忆是电脑上的页（手机只有首页、消息、笔记、信息流），布局量 768 以上。

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { click, layouts, startStack, text, until } from './helpers.ts';

test('记忆：整理前的推测只读、约定和词语的来路、暂缓的词义不催答；浏览不改资料', async (t) => {
  const { app, page } = await startStack(t, { realClock: true, hash: '/memory' });
  const at = app.clock.now().toISOString();
  // 来源证据账 2026-11-05 删了（表在 0062 删）：旧条目只留着来源的 id。
  const source = { id: 'src_fixture' };
  const entry = app.state.memory.create({ kind: 'interpretation', basis: 'inferred',
    text: '这些兴趣用于理解阅读方向，可以按新的证据修订。', sourceId: source.id,
    provenance: '旧版观察原文，保留推测身份。' },
  { actor: 'migration', reason: '隔离历史资料' }, { migratedDefault: true });
  const active = app.state.agreements.importEffective({ kind: 'collaboration', title: '按当前约定合作',
    text: '先理解问题，再给出有依据的答复。', scope: '日常对话', userQuote: '保留原话与来路。' },
  at, { fixture: 'active' }, '隔离历史约定');
  const term = app.state.agreements.importEffective({ kind: 'term', title: '先看依据',
    text: '先核对内容的来源和适用范围。', scope: '共同思考', termTier: 'exact' },
  at, { fixture: 'term' }, '隔离词语原文');
  const deferredTerm = app.state.agreements.create({ kind: 'term', title: '暂缓的词义提议',
    text: '这条定义还在讨论，可以稍后再定。', scope: '共同思考', termTier: 'exact' },
  { actor: 'brain', reason: '隔离暂缓提议' });
  const snapshot = () => ({ entry: app.state.memory.require(entry.id), active: app.state.agreements.require(active.id),
    term: app.state.agreements.require(term.id),
    deferredTerm: app.state.agreements.require(deferredTerm.id) });
  const before = snapshot();

  await page.evaluate(`location.hash = ${JSON.stringify(`#/memory/entries/${entry.id}`)}`);
  const focus = `document.querySelector('[aria-label="引用的条目"]')`;
  await until(page, text(entry.text, focus), '整理前的推测');
  assert.equal(await page.evaluate(`Boolean(${text('整理进主题记忆之前的一条解释（只读）', focus)})`), true);
  await layouts(page, 'memory-entry', '.shell-main .agreements-page', false);

  // 约定、词语 11-05 并进「怎么替你做事」文档；引用里指向的一条单独读：那一行和它的版本来路。
  await page.evaluate(`location.hash = ${JSON.stringify(`#/memory/agreements/${active.id}`)}`);
  await until(page, text(active.text, focus), '引用的约定');
  await until(page, `(${focus})?.querySelector('.change-log')?.textContent.includes('迁移')`, '约定的来路');
  assert.equal(await page.evaluate(`Boolean(${text('生效', focus)})`), true);
  await page.evaluate(`location.hash = ${JSON.stringify(`#/memory/terms/${deferredTerm.id}`)}`);
  await until(page, text(deferredTerm.text, focus), '暂缓的词义提议');
  assert.equal(await page.evaluate(`(${focus}).querySelector('.ask-card') !== null`), false,
    '已暂缓的问题不在这里重新催答');
  assert.equal(await page.evaluate(`Array.from((${focus}).querySelectorAll('button'))
    .some((node) => node.textContent.trim() === '确认生效')`), true, '仍可明确采纳');
  await page.evaluate(`location.hash = ${JSON.stringify(`#/memory/terms/${term.id}`)}`);
  await until(page, `(${focus})?.querySelector('.change-log')?.textContent.includes('迁移')`, '词语来路');
  await layouts(page, 'memory-term', '.shell-main .agreements-page', false);
  assert.deepEqual(snapshot(), before, '浏览和展开来路不改资料、状态和版本');
  assert.equal(app.requests.length, 0, '没有调模型');
});

test('技能：设置 · AI 的技能目录读方法正文，不显示元数据；读不调模型', async (t) => {
  const { app, page } = await startStack(t, { hash: '/settings/ai' });
  const skill = app.app.deps.skills.write({ name: 'research-notes', expectedVersion: null,
    content: '---\nname: research-notes\ndescription: 先核对资料，再整理结论。\n---\n\n# 整理资料\n\n先列问题，再整理证据。',
    files: [{ path: 'references/example.md', content: '# 参考\n\n区分原文与推测。' }] },
  { actionId: 'browser-skill', runId: 'isolated-browser', taskId: null });
  await page.send('Page.reload');
  const catalog = `document.querySelector('[aria-label="技能目录"]')`;
  await until(page, text('research-notes', catalog), '技能目录');
  assert.equal(await page.evaluate(`Boolean(${text('先核对资料，再整理结论。', catalog)})`), true, '说明常显');
  await click(page, '看「research-notes」的方法', catalog);
  const reader = `(${catalog}).querySelector('.skill-method')`;
  await until(page, text('先列问题，再整理证据。', reader), '方法正文');
  assert.equal(await page.evaluate(`(${reader}).querySelector('h1')?.textContent`), '整理资料');
  assert.equal(await page.evaluate(`Boolean(${text('name:', reader)})`), false, '元数据不当正文显示');
  assert.equal(await page.evaluate(`Boolean(${text(skill.version, catalog)})`), true, '写明版本');
  await layouts(page, 'settings-skills', '[aria-labelledby="settings-skills"]');
  assert.equal(app.requests.length, 0);
});
