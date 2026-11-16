// 测试连接（11-16）：两步——读模型列表、让模型回一句；失败时说清是哪一步、为什么（假接口，不联网）。

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

test('通了：列出模型，模型回了一句；请求照 OpenAI 兼容协议发、带 key、不带 store', async () => {
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

test('Base URL 结尾的斜杠不影响；不给模型就只读列表', async () => {
  const server = fakeCompatibleServer();
  const result = await testConnection({ ...base, baseUrl: `${FAKE_BASE}/` }, { fetch: server.fetch });
  assert.equal(result.ok, true);
  assert.equal(result.steps.length, 1);
  assert.equal(server.seen[0]?.url, `${FAKE_BASE}/models`);
});

test('key 不对：说「API Key 不对（401）」，带上服务端原话，不再试第二步', async () => {
  const server = fakeCompatibleServer({ override: { '/models': [401,
    JSON.stringify({ error: { message: 'Incorrect API key provided' } })] } });
  const result = await testConnection({ ...base, models: [plain('monk')] }, { fetch: server.fetch });
  assert.equal(result.ok, false);
  assert.equal(result.steps.length, 1);
  assert.equal(result.steps[0]?.summary, 'API Key 不对（401）');
  assert.equal(result.steps[0]?.detail, 'Incorrect API key provided');
  assert.equal(result.steps[0]?.status, 401);
});

test('连不上：找不到域名、拒绝连接各说各的原因', async () => {
  const dns = await testConnection({ ...base, models: [plain('monk')] },
    { fetch: fakeCompatibleServer({ fail: errno('ENOTFOUND', 'getaddrinfo ENOTFOUND llm.example.com') }).fetch });
  assert.equal(dns.ok, false);
  assert.match(dns.steps[0]?.summary ?? '', /找不到这个域名/);
  assert.match(dns.steps[0]?.detail ?? '', /ENOTFOUND/);
  const refused = await testConnection(base,
    { fetch: fakeCompatibleServer({ fail: errno('ECONNREFUSED', 'connect ECONNREFUSED') }).fetch });
  assert.match(refused.steps[0]?.summary ?? '', /拒绝连接/);
});

test('模型名不对：列表那步过了，回一句那步说「模型名不对」', async () => {
  const result = await testConnection({ ...base, models: [plain('monk-x')] }, { fetch: fakeCompatibleServer().fetch });
  assert.equal(result.ok, false);
  assert.equal(result.steps[0]?.ok, true);
  assert.equal(result.steps[1]?.summary, '模型名不对：接口说没有「monk-x」（404）');
  assert.match(result.steps[1]?.detail ?? '', /does not exist/);
});

test('地址指到了网页：说「返回的是一个网页」，提示查 Base URL', async () => {
  const server = fakeCompatibleServer({ override: { '/models': [200, '<!doctype html><title>Home</title>'],
    '/chat/completions': [404, '<html>404</html>'] } });
  const result = await testConnection({ ...base, models: [plain('monk')] }, { fetch: server.fetch });
  assert.equal(result.ok, false);
  assert.equal(result.steps[0]?.summary, '模型列表读不懂：检查 Base URL');
  assert.equal(result.steps[0]?.detail, '返回的是一个网页，不是接口');
  assert.match(result.steps[1]?.summary ?? '', /404/);
});

test('Anthropic 协议：填了 /v1 也只接一次 /v1，带 x-api-key 和版本头', async () => {
  const server = fakeCompatibleServer();
  await testConnection({ protocol: 'anthropic-messages', baseUrl: FAKE_BASE, apiKey: FAKE_KEY },
    { fetch: server.fetch });
  assert.equal(server.seen[0]?.url, `${FAKE_BASE}/models`);
  assert.equal(server.seen[0]?.headers['x-api-key'], FAKE_KEY);
  assert.equal(server.seen[0]?.headers['anthropic-version'], '2023-06-01');
});

test('几个模型一起试：标了能思考的带「较低」，能看图的带一张图；列表给了上下文长度就带回来', async () => {
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

test('不认思考参数、不收图片：拆掉那一样能回，就说清是哪一样', async () => {
  const thinking = await testConnection({ ...base, models: [plain('monk', { reasoning: true })] },
    { fetch: fakeCompatibleServer({ rejectReasoning: true }).fetch });
  assert.equal(thinking.ok, false);
  assert.equal(thinking.steps[1]?.summary, 'monk 能回复，但不认思考参数，取消「能思考」');
  const images = await testConnection({ ...base, models: [plain('monk', { reasoning: true, images: true })] },
    { fetch: fakeCompatibleServer({ rejectImages: true }).fetch });
  assert.equal(images.steps[1]?.summary, 'monk 能回复，但不收图片，取消「能看图」');
  assert.match(images.steps[1]?.detail ?? '', /pong/);
});
