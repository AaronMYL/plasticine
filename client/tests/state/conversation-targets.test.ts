import { expect, it } from 'vitest';
import { createClientState } from '../../src/state/context.tsx';
import { createFakeApi } from '../../src/api/fake/index.ts';
import { MAIN_LINE_ALIAS } from '../../src/api/shared.ts';
import { DockTargets } from '../../src/state/conversation-targets.ts';

it('每条线的文字、引用和附件相互独立，切回来保留原稿，主线旧入口使用同一份', async () => {
  const state = createClientState({ storage: null });
  const main = state.conversations.forLine(MAIN_LINE_ALIAS);
  expect(main.ui).toBe(state.conversationUi);
  expect(main.attachments).toBe(state.attachments);
  const first = state.conversations.forLine('mate-first');
  const second = state.conversations.forLine('mate-second');
  first.ui.setDraft('先看这份资料');
  first.ui.addQuote({ id: 'q', kind: 'note', sourceId: 'n', label: '示例笔记', text: '引用片段' });
  const fake = createFakeApi({ seed: false, streamStepMs: 0 });
  fake.control.session.signInForDevelopment('测试机');
  await first.attachments.add([new File(['正文'], '资料.txt', { type: 'text/plain' })], fake.api.attachments);
  expect(second.ui.store.get().draft).toBe('');
  expect(second.ui.store.get().quotes).toEqual([]);
  expect(second.attachments.active()).toEqual([]);
  expect(state.attachments.active()).toEqual([]);
  expect(state.conversations.forLine('mate-first')).toBe(first);
  expect(first.attachments.takeReady()).toHaveLength(1);
  second.ui.setDraft('另一份草稿');
  expect(first.ui.store.get().draft).toBe('先看这份资料');
  expect(createClientState().conversations.forLine('mate-first').ui.store.get().draft).toBe('');
});

it('作者队友优先于这类页面上次选择，没有作者时用记住的目标；异步作者不会盖掉当前页手选', () => {
  const targets = new DockTargets(null);
  const allowed = new Set([MAIN_LINE_ALIAS, 'mate-a', 'mate-b', 'group-c']);
  targets.enterPage('note:1', 'notes', null, allowed);
  expect(targets.store.get().lineId).toBe(MAIN_LINE_ALIAS);
  targets.choose('mate-a');
  targets.enterPage('note:2', 'notes', null, allowed);
  expect(targets.store.get().lineId).toBe('mate-a');
  targets.enterPage('space:1', 'library', 'mate-b', allowed);
  expect(targets.store.get()).toMatchObject({ lineId: 'mate-b', fromWriter: true });
  targets.choose('group-c');
  targets.enterPage('space:1', 'library', 'mate-b', allowed);
  expect(targets.store.get()).toMatchObject({ lineId: 'group-c', fromWriter: false });
  targets.enterPage('space:2', 'library', null, allowed);
  expect(targets.store.get().lineId).toBe('group-c');
  targets.enterPage('space:2', 'library', 'mate-b', allowed);
  expect(targets.store.get().lineId).toBe('mate-b');
  targets.enterPage('space:2', 'library', 'mate-b', new Set([MAIN_LINE_ALIAS]));
  expect(targets.store.get().lineId).toBe(MAIN_LINE_ALIAS);
});

it('队友草稿也参与离开提醒，确认保存后刷新仍回到原来的那条线', async () => {
  const { hasUnsavedWork } = await import('../../src/shell/unsaved-guard.ts');
  const data = new Map<string, string>();
  const storage = { getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => { data.set(key, value); }, removeItem: (key: string) => { data.delete(key); } };
  const first = createClientState({ storage });
  first.conversations.forLine('mate-persist').ui.setDraft('下次继续检查');
  expect(hasUnsavedWork(first)).toBe(true);
  first.conversations.saveForRefresh();
  expect(hasUnsavedWork(first)).toBe(false);
  const reloaded = createClientState({ storage });
  expect(reloaded.conversations.forLine('mate-persist').ui.store.get().draft).toBe('下次继续检查');
  expect(reloaded.conversationUi.store.get().draft).toBe('');
});
