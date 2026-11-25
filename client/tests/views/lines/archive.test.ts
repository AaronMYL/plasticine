import { describe, expect, it } from 'vitest';
import { createFakeApi } from '../../../src/api/fake/index.ts';
import { EventsHub } from '../../../src/state/events-hub.ts';
import { LinesStore } from '../../../src/views/lines/line-store.ts';

const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

describe('Archived work list', () => {
  it('initial load hides archived items; reading history does not re-add them or change counts', async () => {
    const fake = createFakeApi({ seed: false, streamStepMs: 0, now: () => new Date('2026-11-06T12:00:00Z') });
    fake.control.session.signInForDevelopment('测试');
    fake.control.lines.put(fake.control.lines.blank('archived', 'background', '已取消', {
      status: 'paused', pauseReason: 'user', archivedAt: '2026-11-06T12:00:00Z',
    }));
    fake.control.lines.put(fake.control.lines.blank('keep', 'background', '保留的修复'));
    const store = new LinesStore(fake.api, new EventsHub(fake.api.events));
    await store.loadList();
    expect(store.list.get().lines.map((line) => line.id).sort()).toEqual(['keep', 'line-main']);
    await store.loadLatest('archived');
    expect(store.thread('archived').get().line?.title).toBe('已取消');
    expect(store.list.get().lines).toHaveLength(2);
    expect((await fake.api.lines.list({ includeArchived: true })).lines).toHaveLength(3);
  });

  it('archive event removes item immediately without reviving old events until explicit restore', async () => {
    const fake = createFakeApi({ seed: false, streamStepMs: 0, now: () => new Date('2026-11-06T12:00:00Z') });
    fake.control.session.signInForDevelopment('测试');
    const old = fake.control.lines.blank('work', 'background', '已取消', { status: 'paused' });
    fake.control.lines.put(old);
    const hub = new EventsHub(fake.api.events);
    const store = new LinesStore(fake.api, hub);
    hub.start();
    store.start();
    await flush();
    try {
      expect(store.lineOf('work')).not.toBeNull();
      const archived = { ...old, archivedAt: '2026-11-06T13:00:00Z', updatedAt: '2026-11-06T13:00:00Z' };
      fake.control.lines.put(archived);
      await flush();
      expect(store.lineOf('work')).toBeNull();
      fake.control.lines.put(old);
      await flush();
      expect(store.lineOf('work')).toBeNull();
      await store.loadList();
      expect(store.lineOf('work')).toBeNull();
      fake.control.lines.put({ ...old, archivedAt: null, updatedAt: '2026-11-06T14:00:00Z' });
      await flush();
      expect(store.lineOf('work')?.status).toBe('paused');
    } finally {
      store.stop();
      hub.stop();
    }
  });
});
