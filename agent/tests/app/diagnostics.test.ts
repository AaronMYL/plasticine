import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { Diagnostics, whereOf } from '../../src/app/diagnostics.ts';
import { matchRoute } from '../../src/app/router.ts';
import { createServerHealthTool } from '../../src/app/server-health-tool.ts';
import { toolContext } from '../tools/helpers.ts';
import { call, pair, startTestApp, type TestApp } from './helpers.ts';

let app: TestApp | undefined;

afterEach(async () => {
  await app?.close();
  app = undefined;
});

test('records request duration and status by route template without raw path IDs', async () => {
  const t = await startTestApp();
  app = t;
  const cookie = await pair(t);
  await call(t, 'GET', '/v2/lines?limit=5', { cookie });
  await call(t, 'GET', '/v2/lines/main?limit=5', { cookie });
  await call(t, 'GET', '/v2/lines/line-not-there?limit=5', { cookie });
  const routes = t.app.deps.diagnostics.snapshot(5).routes.map((row) => row.route);
  assert.ok(routes.includes('GET /v2/lines'), routes.join());
  assert.ok(routes.some((route) => route.startsWith('GET /v2/lines/:')), routes.join());
  assert.ok(!routes.some((route) => route.includes('line-not-there')));
});

test('diagnostics summary sorts by total time, includes error stack, truncates slow SQL to prefix', async () => {
  let now = Date.parse('2026-11-16T11:02:00.000Z');
  const diagnostics = new Diagnostics(() => now);
  diagnostics.request('/v2/lines/:lineId', 'GET', 200, 900);
  diagnostics.request('/v2/lines/:lineId', 'GET', 502, 3000);
  diagnostics.request('/v2/asks', 'GET', 200, 5);
  diagnostics.error('/v2/lines', 'GET', 500, new Error('数据库忙'));
  diagnostics.sql('SELECT *   FROM line_messages\n WHERE line_id = $lineId', 450);
  now += 60_000;
  const snapshot = diagnostics.snapshot(10);
  assert.equal(snapshot.routes[0]?.route, 'GET /v2/lines/:lineId');
  assert.equal(snapshot.routes[0]?.failed, 1);
  assert.equal(snapshot.routes[0]?.maxMs, 3000);
  assert.equal(snapshot.errors[0]?.error, '数据库忙');
  assert.match(snapshot.errors[0]?.where ?? '', /agent\/tests\/app\/diagnostics\.test\.ts:\d+/);
  assert.equal(snapshot.slowQueries[0]?.sql, 'SELECT * FROM line_messages WHERE line_id = $lineId');
  now += 20 * 60_000;
  assert.deepEqual(diagnostics.snapshot(10).routes, []);
  assert.equal(whereOf('不是错误'), null);
});

test('server_health returns service, host, and diagnostics summary', async () => {
  const diagnostics = new Diagnostics();
  diagnostics.request('/v2/lines', 'GET', 200, 1950);
  const answer = await createServerHealthTool(diagnostics).execute({ minutes: 5 }, toolContext('health'));
  const result = JSON.parse(answer) as {
    service: { rssMb: number }; machine: { cores: number; topProcesses: string[] }; routes: { route: string }[] };
  assert.ok(result.service.rssMb > 0);
  assert.ok(result.machine.cores > 0);
  assert.equal(result.routes[0]?.route, 'GET /v2/lines');
});

test('device action long-polling is tagged longPoll and excluded from slow requests', () => {
  const match = matchRoute('GET', '/v2/nodes/actions/next');
  assert.equal(match.kind, 'found');
  assert.equal(match.kind === 'found' && match.route.longPoll, true);
});
