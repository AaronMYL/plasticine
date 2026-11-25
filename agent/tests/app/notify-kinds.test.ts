import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { HubStreamEvent } from '../../shared/api/index.ts';
import { call, json, pair, startTestApp } from './helpers.ts';

const PATH = '/v2/push/kinds';

test('notification prefs default all 7 on, save/read whole set, broadcast, reject missing/extra keys', async () => {
  const app = await startTestApp([], { startTasks: false });
  try {
    const cookie = await pair(app);
    assert.equal((await call(app, 'GET', PATH)).status, 401);
    assert.deepEqual(json(await call(app, 'GET', PATH, { cookie })), { ask: true, contact: true, group: true,
      main: true, mate: true, letter: true, notice: true });
    const events: HubStreamEvent[] = [];
    const publish = app.app.deps.hub.publish.bind(app.app.deps.hub);
    app.app.deps.hub.publish = (event) => {
      events.push(event);
      return publish(event);
    };
    const next = { ask: false, contact: true, group: false, main: true, mate: true, letter: true, notice: true };
    assert.deepEqual(json(await call(app, 'PUT', PATH, { cookie, body: next })), next);
    assert.deepEqual(json(await call(app, 'GET', PATH, { cookie })), next);
    assert.deepEqual(events.filter((event) => event.type === 'notify_kinds_changed'),
      [{ type: 'notify_kinds_changed', kinds: next }]);
    const { notice: _notice, ...missing } = next;
    assert.equal((await call(app, 'PUT', PATH, { cookie, body: missing })).status, 400);
    assert.equal((await call(app, 'PUT', PATH, { cookie, body: { ...next, extra: true } })).status, 400);
  } finally {
    await app.close();
  }
});
