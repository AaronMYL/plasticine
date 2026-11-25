import assert from 'node:assert/strict';
import { test } from 'node:test';
import { KernelImages } from '../../src/kernel/index.ts';

function token(accountId: string): string {
  const payload = Buffer.from(JSON.stringify({ 'https://api.openai.com/auth': { chatgpt_account_id: accountId } }))
    .toString('base64url');
  return `header.${payload}.signature`;
}

type Auth = { auth: { apiKey?: string }; source?: string } | undefined;

function models(auths: Record<string, Auth>) {
  return {
    getAuth: async (provider: unknown) => auths[String(provider)],
    getModels: () => [{ id: 'gpt-6.1-sol' }],
  } as never;
}

const signal = new AbortController().signal;

test('ChatGPT sub calls Codex Responses with image_generation and reads streamed result', async () => {
  const calls: { url: string; headers: Record<string, string>; body: Record<string, unknown> }[] = [];
  const image = Buffer.from('webp-bytes').toString('base64');
  const fetcher = (async (url: string, init: RequestInit) => {
    calls.push({ url, headers: init.headers as Record<string, string>, body: JSON.parse(String(init.body)) });
    const events = [
      `event: response.image_generation_call.partial_image\ndata: ${JSON.stringify({ partial_image_b64: 'xx' })}`,
      `data: ${JSON.stringify({ type: 'response.output_item.done', item: { type: 'image_generation_call',
        result: image } })}`,
      'data: [DONE]',
    ].join('\n\n');
    return new Response(events, { status: 200 });
  }) as typeof fetch;
  const images = new KernelImages({ models: models({ 'openai-codex': { auth: { apiKey: token('acct-1') } } }),
    codexModel: () => 'gpt-6.1-sol', fetch: fetcher });
  const drawn = await images.draw('夜里，散落的便签连成一张网', signal);
  assert.ok('data' in drawn);
  assert.equal(drawn.data.toString(), 'webp-bytes');
  assert.equal(drawn.mime, 'image/webp');
  const call = calls[0];
  assert.equal(call?.url, 'https://chatgpt.com/backend-api/codex/responses');
  assert.equal(call?.headers['chatgpt-account-id'], 'acct-1');
  assert.equal(call?.body['model'], 'gpt-6.1-sol');
  assert.deepEqual(call?.body['tool_choice'], { type: 'allowed_tools', mode: 'required',
    tools: [{ type: 'image_generation' }] });
  assert.match(JSON.stringify(call?.body['input']), /散落的便签/);
});

test('OpenAI key uses Images API; disconnected, API error, and quota return single reason', async () => {
  const fetcher = (async (url: string) => {
    assert.equal(url, 'https://api.openai.com/v1/images/generations');
    return Response.json({ data: [{ b64_json: Buffer.from('png').toString('base64') }] });
  }) as typeof fetch;
  const keyed = new KernelImages({ models: models({ openai: { auth: { apiKey: 'sk-test' } } }), fetch: fetcher });
  const drawn = await keyed.draw('一本摊开的期刊', signal);
  assert.ok('data' in drawn && drawn.data.toString() === 'png');
  const none = new KernelImages({ models: models({}) });
  assert.deepEqual(await none.draw('图', signal),
    { error: '没有连能出图的登录：在 设置 › AI 里登录「ChatGPT（Codex）」，或填 OpenAI 的 API key' });
  const limited = new KernelImages({ models: models({ openai: { auth: { apiKey: 'sk-test' } } }),
    fetch: (async () => new Response('', { status: 429 })) as typeof fetch });
  assert.deepEqual(await limited.draw('图', signal), { error: '出图额度用完了' });
  const broken = new KernelImages({ models: models({ openai: { auth: { apiKey: 'sk-test' } } }),
    fetch: (async () => {
      throw new Error('socket hang up');
    }) as typeof fetch });
  assert.deepEqual(await broken.draw('图', signal), { error: '出图失败：socket hang up' });
});

test('Sign in with ChatGPT skips image API and explains which login supports image generation', async () => {
  let called = false;
  const images = new KernelImages({ models: models({ openai: { auth: { apiKey: 'oauth-access' }, source: 'OAuth' } }),
    fetch: (async () => {
      called = true;
      return new Response('', { status: 401 });
    }) as typeof fetch });
  assert.deepEqual(await images.draw('图', signal), {
    error: '「Sign in with ChatGPT」这种登录 OpenAI 不让出图：在 设置 › AI 里再登录「ChatGPT（Codex）」就能出图' });
  assert.equal(called, false);
});

test('image API failure reports real cause: expired Codex login, quota exhausted, or API error', async () => {
  const codex = (response: Response) => new KernelImages({
    models: models({ 'openai-codex': { auth: { apiKey: token('acct-1') }, source: 'OAuth' } }),
    codexModel: () => 'gpt-6.1-sol', fetch: (async () => response) as typeof fetch });
  assert.deepEqual(await codex(new Response('{}', { status: 401 })).draw('图', signal),
    { error: '「ChatGPT（Codex）」的登录过期了：到 设置 › AI 重新登录' });
  assert.deepEqual(await codex(new Response('{}', { status: 429 })).draw('图', signal),
    { error: 'ChatGPT 订阅的出图额度用完了，过一阵再试' });
  const said = Response.json({ error: { message: 'Tool image_generation is not supported for this plan.' } },
    { status: 400 });
  assert.deepEqual(await codex(said).draw('图', signal),
    { error: '出图接口回了 400：Tool image_generation is not supported for this plan.' });
  const keyed = new KernelImages({ models: models({ openai: { auth: { apiKey: 'sk-test' } } }),
    fetch: (async () => Response.json({ detail: 'Invalid key' }, { status: 401 })) as typeof fetch });
  assert.deepEqual(await keyed.draw('图', signal), { error: 'OpenAI 的 API key 不对或没有出图权限：Invalid key' });
});

function echoed(model: string, extra: string[] = []): Response {
  return new Response([
    `data: ${JSON.stringify({ type: 'response.created', response: { tools: [{ type: 'image_generation', model,
      size: 'auto', quality: 'auto' }] } })}`,
    ...extra, 'data: [DONE]'].join('\n\n'), { status: 200 });
}

test('image model row queries sub endpoint once per account, uses fixed model for key, else null', async () => {
  const bodies: Record<string, unknown>[] = [];
  const asked = new KernelImages({ models: models({ 'openai-codex': { auth: { apiKey: token('acct-model') } } }),
    codexModel: () => 'gpt-6.1-sol', fetch: (async (_url: string, init: RequestInit) => {
      bodies.push(JSON.parse(String(init.body)));
      return echoed('gpt-image-2-codex');
    }) as typeof fetch });
  assert.equal(await asked.model(signal), 'gpt-image-2-codex');
  assert.equal(bodies[0]?.['tool_choice'], 'none');
  assert.equal(await asked.model(signal), 'gpt-image-2-codex');
  assert.equal(bodies.length, 1, '一天里问过就不再问');
  const keyed = new KernelImages({ models: models({ openai: { auth: { apiKey: 'sk-test' } } }) });
  assert.equal(await keyed.model(signal), 'gpt-image-1');
  const oauth = new KernelImages({ models: models({ openai: { auth: { apiKey: 'x' }, source: 'OAuth' } }) });
  assert.equal(await oauth.model(signal), null);
  assert.equal(await new KernelImages({ models: models({}) }).model(signal), null);
  const failing = new KernelImages({ models: models({ 'openai-codex': { auth: { apiKey: token('acct-down') } } }),
    codexModel: () => 'gpt-6.1-sol', fetch: (async () => new Response('', { status: 500 })) as typeof fetch });
  assert.equal(await failing.model(signal), null, '问不出来就不写模型，不报错');
});

test('caches model name returned during image generation to avoid re-querying', async () => {
  let calls = 0;
  const image = Buffer.from('webp-bytes').toString('base64');
  const images = new KernelImages({ models: models({ 'openai-codex': { auth: { apiKey: token('acct-draw') } } }),
    codexModel: () => 'gpt-6.1-sol', fetch: (async () => {
      calls += 1;
      return echoed('gpt-image-2-codex', [`data: ${JSON.stringify({ type: 'response.output_item.done',
        item: { type: 'image_generation_call', result: image } })}`]);
    }) as typeof fetch });
  assert.ok('data' in await images.draw('湖边的纸船', signal));
  assert.equal(await images.model(signal), 'gpt-image-2-codex');
  assert.equal(calls, 1);
});
