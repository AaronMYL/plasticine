import { expect, it, vi } from 'vitest';
import { HttpNotes } from '../../src/api/http/notes.ts';
import { createSpacesHttp } from '../../src/api/http/spaces.ts';
import { LocalEvents } from '../../src/api/http/local-events.ts';
import { Transport } from '../../src/api/http/transport.ts';
import { createRequestId } from '../../src/api/request-id.ts';

it('四个批量入口发送共享请求格式，笔记成功回执同步本地失效事件', async () => {
  const fetch = vi.fn(async (_url: string) => ({ status: 200,
    text: async () => JSON.stringify({ results: [{ kind: 'note', id: 'a', title: '示例笔记', ok: true, error: null }],
      succeeded: 1, failed: 0 }) }));
  const transport = new Transport({ fetch, onUnauthorized: vi.fn() });
  const local = new LocalEvents();
  const onEvent = vi.fn();
  local.on(onEvent);
  const notes = new HttpNotes(transport, local);
  const { library } = createSpacesHttp(transport);
  await notes.batch({ requestId: createRequestId(), action: 'move', destination: '归档',
    items: [{ kind: 'note', id: 'a' }] });
  await notes.batch({ requestId: createRequestId(), action: 'purge', items: [{ kind: 'note', id: 'a' }] });
  expect(onEvent).toHaveBeenCalledWith({ type: 'note.deleted', noteId: 'a' });
  await notes.emptyTrash({ requestId: createRequestId(), expectCount: 1 });
  await library.batch({ requestId: createRequestId(), action: 'restore', items: [{ kind: 'space', id: 'b' }] });
  await library.emptyTrash({ requestId: createRequestId(), expectCount: 4 });
  expect(fetch.mock.calls.map((call) => call[0])).toEqual([
    '/v2/notes/batch', '/v2/notes/batch', '/v2/notes/trash/empty', '/v2/library/batch', '/v2/library/trash/empty',
  ]);
  expect(onEvent).toHaveBeenCalledWith({ type: 'note.invalidated', noteId: 'folders' });
  expect(onEvent).toHaveBeenCalledWith({ type: 'note.deleted', noteId: 'a' });
});
