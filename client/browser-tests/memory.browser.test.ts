// 记忆和技能在真服务端上读：引用里指向的一条单独读——整理前的推测（只读）；技能页（11-13 起单独一页）读方法正文
// （不显示元数据）。浏览不改任何资料、不调模型。约定和词语 11-16 整个删了，原来测它们来路的那一段跟着删。
// 记忆是电脑上的页（手机只有首页、消息、笔记、信息流），布局量 768 以上。

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { click, layouts, startStack, text, until } from './helpers.ts';

test('记忆：整理前的推测单独读，只读；浏览不改资料、不调模型', async (t) => {
  const { app, page } = await startStack(t, { realClock: true, hash: '/memory' });
  // 来源证据账 2026-11-05 删了（表在 0062 删）：旧条目只留着来源的 id。约定和词语 11-16 整个删了（0141），不再测。
  const source = { id: 'src_fixture' };
  const entry = app.state.memory.create({ kind: 'interpretation', basis: 'inferred',
    text: '这些兴趣用于理解阅读方向，可以按新的证据修订。', sourceId: source.id,
    provenance: '旧版观察原文，保留推测身份。' },
  { actor: 'migration', reason: '隔离历史资料' }, { migratedDefault: true });
  const before = app.state.memory.require(entry.id);

  await page.evaluate(`location.hash = ${JSON.stringify(`#/memory/entries/${entry.id}`)}`);
  const focus = `document.querySelector('[aria-label="引用的条目"]')`;
  await until(page, text(entry.text, focus), '整理前的推测');
  assert.equal(await page.evaluate(`Boolean(${text('整理进主题记忆之前的一条解释（只读）', focus)})`), true);
  assert.equal(await page.evaluate(`(${focus}).querySelector('button, input, textarea') === null`), true, '只读');
  assert.deepEqual(app.state.memory.require(entry.id), before, '浏览不改资料、状态和版本');
  assert.equal(app.requests.length, 0, '没有调模型');
});

test('技能：技能页（11-13 从设置 · AI 搬出来）目录写说明，点开读方法正文，不显示元数据；读不调模型', async (t) => {
  const { app, page } = await startStack(t, { hash: '/skills' });
  const skill = app.app.deps.skills.write({ name: 'research-notes', expectedVersion: null,
    content: '---\nname: research-notes\ndescription: 先核对资料，再整理结论。\n---\n\n# 整理资料\n\n先列问题，再整理证据。',
    files: [{ path: 'references/example.md', content: '# 参考\n\n区分原文与推测。' }] },
  { actionId: 'browser-skill', runId: 'isolated-browser', taskId: null });
  await page.send('Page.reload');
  const catalog = `document.querySelector('[aria-label="技能目录"]')`;
  await until(page, text('research-notes', catalog), '技能目录');
  assert.equal(await page.evaluate(`Boolean(${text('先核对资料，再整理结论。', catalog)})`), true, '说明常显');
  await until(page, `(() => { const link = Array.from(document.querySelectorAll('a.skill-card'))
    .find((node) => node.textContent.includes('research-notes')); link?.click(); return link !== undefined; })()`,
  '点开 research-notes');
  const detail = `document.querySelector('article[aria-label="research-notes"]')`;
  const reader = `(${detail})?.querySelector('.skill-method')`;
  await until(page, text('先列问题，再整理证据。', reader), '方法正文');
  assert.equal(await page.evaluate(`(${reader}).querySelector('h1')?.textContent`), '整理资料');
  assert.equal(await page.evaluate(`Boolean(${text('name:', reader)})`), false, '元数据不当正文显示');
  assert.equal(await page.evaluate(`Boolean(${text(skill.version, detail)})`), true, '写明版本');
  await layouts(page, 'skills-page', '.skills-root');
  assert.equal(app.requests.length, 0);
});
