import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { renderApp, NOW } from '../../helpers.tsx';
import { createRequestId } from '../../../src/api/request-id.ts';
import { MAIN_LINE_ALIAS } from '../../../src/api/shared.ts';

it('已归档作者后台线通过read查队友，页面默认该队友，信息流讨论也进入当前目标', async () => {
  const app = await renderApp({ hash: '#/today', setup: ({ control }) => {
    control.spaces.seed();
    control.feed.seedItem({ id: 'feed-proof', title: '来源核对', summary: '这是一条可引用的示例。' });
  } });
  const mate = await act(() => app.api.mates.create({ requestId: createRequestId(), name: '研究队友', avatar: 'cat',
    hue: 'sky', role: '研究资料', soul: '', purpose: null }));
  act(() => app.control.lines.put(app.control.lines.blank('writer-archived', 'background', '写报告',
    { mateId: mate.id, archivedAt: NOW.toISOString() })));
  const original = app.api.spaces.get.bind(app.api.spaces);
  vi.spyOn(app.api.spaces, 'get').mockImplementation(async (id, signal) =>
    ({ ...await original(id, signal), writerLineId: 'writer-archived' }));
  const read = vi.spyOn(app.api.lines, 'read');
  const space = (await app.api.spaces.list()).spaces[0]!;
  act(() => { window.location.hash = `#/books/space/${space.id}`; });
  await waitFor(() => expect(app.state.dockTargets.store.get()).toMatchObject({
    lineId: mate.lineId, fromWriter: true }));
  expect(read.mock.calls.some(([id, query]) => id === 'writer-archived' && query.limit === 1)).toBe(true);
  act(() => { window.location.hash = '#/feed'; });
  await waitFor(() => expect(app.state.dockTargets.store.get().pageKind).toBe('feed'));
  act(() => app.state.dockTargets.choose(mate.lineId));
  fireEvent.click(await screen.findByRole('button', { name: '讨论' }));
  expect(app.state.conversations.forLine(mate.lineId).ui.store.get().quotes[0]?.text).toContain('可引用的示例');
  expect(app.state.conversations.forLine(MAIN_LINE_ALIAS).ui.store.get().quotes).toEqual([]);
  expect((await app.api.mates.list()).legacyChats).toEqual([]);
});

it('页面作者晚到不能覆盖用户手选', async () => {
  const app = await renderApp({ hash: '#/today', setup: ({ control }) => control.spaces.seed() });
  const mate = await act(() => app.api.mates.create({ requestId: createRequestId(), name: '写作队友', avatar: 'bunny',
    hue: 'teal', role: '写作资料', soul: '', purpose: null }));
  const space = (await app.api.spaces.list()).spaces[0]!;
  const original = await app.api.spaces.get(space.id);
  let finish: (() => void) | undefined;
  const waiting = new Promise<void>((resolve) => { finish = resolve; });
  vi.spyOn(app.api.spaces, 'get').mockImplementation(async () => {
    await waiting;
    return { ...original, writerLineId: mate.lineId };
  });
  act(() => { window.location.hash = `#/books/space/${space.id}`; });
  await waitFor(() => expect(app.state.dockTargets.store.get().pageKind).toBe('spaces'));
  act(() => app.state.dockTargets.choose(MAIN_LINE_ALIAS));
  await act(async () => { finish?.(); });
  expect(app.state.dockTargets.store.get()).toMatchObject({ lineId: MAIN_LINE_ALIAS, fromWriter: false });
});
