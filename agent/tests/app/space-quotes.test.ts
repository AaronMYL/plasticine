import assert from 'node:assert/strict';
import { test } from 'node:test';
import { EMPTY_SPACE_DOC } from '../../shared/state.ts';
import { resolveConversationQuotes } from '../../src/app/conversation-quotes.ts';
import { ApiError } from '../../src/app/api-error.ts';
import { openTestState } from '../state/helpers.ts';

test('空间引用核对指定版本和段落，支持跨段选区与改版后的旧引用', async (t) => {
  const fixture = await openTestState();
  t.after(() => fixture.cleanup());
  const { state } = fixture;
  const space = state.spaces.create({ title: '阅读来信', author: 'ai', genre: 'letter', doc: EMPTY_SPACE_DOC,
    html: '<section id="practice"><p>第一段的开头</p><p>第二段的结果</p></section>' });
  const quote = { kind: 'space' as const, spaceReference: { spaceId: space.id, version: 1,
    anchor: { sectionId: 'practice', paragraph: 1, text: '开头\n第二段的结果' } } };
  const result = resolveConversationQuotes(state, '把这段展开', [quote]);
  assert.match(result, /〔空间引用〕/);
  assert.match(result, /开头\n> 第二段的结果/);
  assert.match(result, /第 1 段/);
  state.spaces.save(space.id, space.version, { html: '<p>已经改成新版本</p>' }, 'user');
  assert.equal(resolveConversationQuotes(state, '把这段展开', [quote]), result);
});

test('引用不存在的原文、错误段落或小节会拒绝，清空后的历史也不能重新引用', async (t) => {
  const fixture = await openTestState();
  t.after(() => fixture.cleanup());
  const { state } = fixture;
  const space = state.spaces.create({ title: '报告', author: 'ai', genre: 'report', doc: EMPTY_SPACE_DOC,
    html: '<section id="first"><p>原文内容</p><p>另一段</p></section>' });
  const reference = { spaceId: space.id, version: 1,
    anchor: { sectionId: 'first', paragraph: 1, text: '原文内容' } };
  for (const anchor of [{ ...reference.anchor, text: '捏造的原文' },
    { ...reference.anchor, paragraph: 2 }, { ...reference.anchor, sectionId: 'wrong' }]) {
    assert.throws(() => resolveConversationQuotes(state, '修改', [{ kind: 'space',
      spaceReference: { ...reference, anchor } }]), (error: unknown) =>
      error instanceof ApiError && error.code === 'space_quote_changed');
  }
  state.spaces.markDeleted(space.id, space.version);
  state.libraryPurge.space(space.id);
  assert.throws(() => resolveConversationQuotes(state, '修改', [{ kind: 'space', spaceReference: reference }]));
});
