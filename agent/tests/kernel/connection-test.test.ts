import assert from 'node:assert/strict';
import { test } from 'node:test';
import { testConnection } from '../../src/kernel/index.ts';
import { FAKE_BASE, FAKE_KEY, fakeCompatibleServer } from './fake-compatible-server.ts';

const base = { protocol: 'openai-completions' as const, baseUrl: FAKE_BASE, apiKey: FAKE_KEY };

function plain(id: string, extra: { reasoning?: boolean; images?: boolean } = {}) {
  return { id, reasoning: extra.reasoning ?? false, images: extra.images ?? false, contextWindow: 128_000 };
}

function errno(code: string, message: string): NodeJS.ErrnoException {
  return Object.assign(new Error(message), { code });
}

test('test passes: lists models, gets reply via OpenAI-compatible protocol with key and no store', async () => {
  const server = fakeCompatibleServer({ models: ['monk', 'monk-fast', 'monk-coding'] });
  const result = await testConnection({ ...base, models: [plain('monk')] }, { fetch: server.fetch });
  assert.equal(result.ok, true);
  assert.deepEqual(result.models?.map((model) => model.id), ['monk', 'monk-fast', 'monk-coding']);
  assert.deepEqual(result.steps.map((step) => [step.step, step.ok, step.summary]),
    [['models', true, '接口列出 3 个模型'], ['reply', true, 'monk 回复了']]);
  assert.equal(result.steps[1]?.detail, 'pong');
  const [list, chat] = server.seen;
  assert.equal(list?.url, `${FAKE_BASE}/models`);
  assert.equal(list?.headers['authorization'], `Bearer ${FAKE_KEY}`);
  assert.equal(chat?.url, `${FAKE_BASE}/chat/completions`);
  assert.equal(chat?.headers['authorization'], `Bearer ${FAKE_KEY}`);
  const body = chat?.body as Record<string, unknown>;
  assert.equal(body['model'], 'monk');
  assert.equal(body['store'], undefined, '不认识的服务器不带 store');
  assert.equal(typeof body['max_tokens'], 'number', '上限字段用 max_tokens');
  assert.equal(body['reasoning_effort'], undefined, '没标能思考的不带思考参数');
  assert.equal(JSON.stringify(result).includes(FAKE_KEY), false, '结果里没有 key');
});

test('trailing slash on Base URL is normalized; omitting model only fetches model list', async () => {
  const server = fakeCompatibleServer();
  const result = await testConnection({ ...base, baseUrl: `${FAKE_BASE}/` }, { fetch: server.fetch });
  assert.equal(result.ok, true);
  assert.equal(result.steps.length, 1);
  assert.equal(server.seen[0]?.url, `${FAKE_BASE}/models`);
});

test('bad key reports 401 with raw server message and skips second step', async () => {
  const server = fakeCompatibleServer({ override: { '/models': [401,
    JSON.stringify({ error: { message: 'Incorrect API key provided' } })] } });
  const result = await testConnection({ ...base, models: [plain('monk')] }, { fetch: server.fetch });
  assert.equal(result.ok, false);
  assert.equal(result.steps.length, 1);
  assert.equal(result.steps[0]?.summary, 'API Key 不对（401）');
  assert.equal(result.steps[0]?.detail, 'Incorrect API key provided');
  assert.equal(result.steps[0]?.status, 401);
});

test('connection failure distinguishes DNS lookup error from connection refused', async () => {
  const dns = await testConnection({ ...base, models: [plain('monk')] },
    { fetch: fakeCompatibleServer({ fail: errno('ENOTFOUND', 'getaddrinfo ENOTFOUND llm.example.com') }).fetch });
  assert.equal(dns.ok, false);
  assert.match(dns.steps[0]?.summary ?? '', /找不到这个域名/);
  assert.match(dns.steps[0]?.detail ?? '', /ENOTFOUND/);
  const refused = await testConnection(base,
    { fetch: fakeCompatibleServer({ fail: errno('ECONNREFUSED', 'connect ECONNREFUSED') }).fetch });
  assert.match(refused.steps[0]?.summary ?? '', /拒绝连接/);
});

test('bad model name passes list step and reports invalid model on chat step', async () => {
  const result = await testConnection({ ...base, models: [plain('monk-x')] }, { fetch: fakeCompatibleServer().fetch });
  assert.equal(result.ok, false);
  assert.equal(result.steps[0]?.ok, true);
  assert.equal(result.steps[1]?.summary, '模型名不对：接口说没有「monk-x」（404）');
  assert.match(result.steps[1]?.detail ?? '', /does not exist/);
});

test('HTML response reports webpage returned and suggests checking Base URL', async () => {
  const server = fakeCompatibleServer({ override: { '/models': [200, '<!doctype html><title>Home</title>'],
    '/chat/completions': [404, '<html>404</html>'] } });
  const result = await testConnection({ ...base, models: [plain('monk')] }, { fetch: server.fetch });
  assert.equal(result.ok, false);
  assert.equal(result.steps[0]?.summary, '模型列表读不懂：检查 Base URL');
  assert.equal(result.steps[0]?.detail, '返回的是一个网页，不是接口');
  assert.match(result.steps[1]?.summary ?? '', /404/);
});

test('Anthropic protocol avoids duplicate /v1 and sends x-api-key and version header', async () => {
  const server = fakeCompatibleServer();
  await testConnection({ protocol: 'anthropic-messages', baseUrl: FAKE_BASE, apiKey: FAKE_KEY },
    { fetch: server.fetch });
  assert.equal(server.seen[0]?.url, `${FAKE_BASE}/models`);
  assert.equal(server.seen[0]?.headers['x-api-key'], FAKE_KEY);
  assert.equal(server.seen[0]?.headers['anthropic-version'], '2023-06-01');
});

test('multi-model test sends low thinking if supported, image if vision, returns context length', async () => {
  const server = fakeCompatibleServer({ models: ['monk', 'monk-opus'], contexts: { 'monk-opus': 200_000 } });
  const result = await testConnection({ ...base, models: [plain('monk'),
    plain('monk-opus', { reasoning: true, images: true })] }, { fetch: server.fetch });
  assert.equal(result.ok, true);
  assert.deepEqual(result.steps.slice(1).map((step) => [step.model, step.summary]),
    [['monk', 'monk 回复了'], ['monk-opus', 'monk-opus 回复了（带图 · 较低思考）']]);
  const opus = server.seen.find((request) => (request.body as { model?: string } | null)?.model === 'monk-opus');
  assert.equal((opus?.body as Record<string, unknown>)['reasoning_effort'], 'low');
  assert.match(JSON.stringify(opus?.body), /image_url/);
  assert.deepEqual(result.models, [{ id: 'monk', contextWindow: null }, { id: 'monk-opus', contextWindow: 200_000 }]);
});

test('retries without unsupported thinking or image param and reports which failed', async () => {
  const thinking = await testConnection({ ...base, models: [plain('monk', { reasoning: true })] },
    { fetch: fakeCompatibleServer({ rejectReasoning: true }).fetch });
  assert.equal(thinking.ok, false);
  assert.equal(thinking.steps[1]?.summary, 'monk 能回复，但不认思考参数，取消「能思考」');
  const images = await testConnection({ ...base, models: [plain('monk', { reasoning: true, images: true })] },
    { fetch: fakeCompatibleServer({ rejectImages: true }).fetch });
  assert.equal(images.steps[1]?.summary, 'monk 能回复，但不收图片，取消「能看图」');
  assert.match(images.steps[1]?.detail ?? '', /pong/);
});
