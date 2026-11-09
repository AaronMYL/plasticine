// 出图（第 8 批第 6 条）：连着 ChatGPT 订阅走 Codex 的 Responses 接口带 image_generation 工具，连着 OpenAI key 走
// Images 接口；都没连、接口出错就说一句原因，不抛。不连网：fetch 和凭证都是假的。
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { KernelImages } from '../../src/kernel/index.ts';

function token(accountId: string): string {
  const payload = Buffer.from(JSON.stringify({ 'https://api.openai.com/auth': { chatgpt_account_id: accountId } }))
    .toString('base64url');
  return `header.${payload}.signature`;
}

type Auth = { auth: { apiKey?: string } } | undefined;

function models(auths: Record<string, Auth>) {
  return {
    getAuth: async (provider: unknown) => auths[String(provider)],
    getModels: () => [{ id: 'gpt-6.1-sol' }],
  } as never;
}

const signal = new AbortController().signal;

test('ChatGPT 订阅：Codex Responses 带 image_generation（必须出图），从流里读 image_generation_call 的结果', async () => {
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

test('OpenAI key：Images 接口；都没连、接口出错、超额都只回一句原因', async () => {
  const fetcher = (async (url: string) => {
    assert.equal(url, 'https://api.openai.com/v1/images/generations');
    return Response.json({ data: [{ b64_json: Buffer.from('png').toString('base64') }] });
  }) as typeof fetch;
  const keyed = new KernelImages({ models: models({ openai: { auth: { apiKey: 'sk-test' } } }), fetch: fetcher });
  const drawn = await keyed.draw('一本摊开的期刊', signal);
  assert.ok('data' in drawn && drawn.data.toString() === 'png');
  const none = new KernelImages({ models: models({}) });
  assert.deepEqual(await none.draw('图', signal), { error: '没有连能出图的模型（ChatGPT 订阅或 OpenAI API key）' });
  const limited = new KernelImages({ models: models({ openai: { auth: { apiKey: 'sk-test' } } }),
    fetch: (async () => new Response('', { status: 429 })) as typeof fetch });
  assert.deepEqual(await limited.draw('图', signal), { error: '出图额度用完了' });
  const broken = new KernelImages({ models: models({ openai: { auth: { apiKey: 'sk-test' } } }),
    fetch: (async () => {
      throw new Error('socket hang up');
    }) as typeof fetch });
  assert.deepEqual(await broken.draw('图', signal), { error: '出图失败：socket hang up' });
});
