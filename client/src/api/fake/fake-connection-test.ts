// 假的测试连接：照服务端两步的样子回结论，规则固定好做截图和测试——
// 地址里有 nowhere 就找不到域名；key 里有 bad 就是 401；模型不在列表里就是模型名不对；其余都通。

import type { TestModelConnectionRequest, TestModelConnectionResponse } from '../shared.ts';

export const FAKE_LISTED_MODELS: readonly string[] = ['chat-large', 'chat-fast', 'chat-coder', 'chat-mini'];

export function fakeConnectionTest(body: TestModelConnectionRequest): TestModelConnectionResponse {
  if (body.baseUrl.includes('nowhere')) {
    return { ok: false, models: null, steps: [{ step: 'models', ok: false,
      summary: '找不到这个域名，检查 Base URL 有没有拼错', detail: 'ENOTFOUND getaddrinfo ENOTFOUND',
      status: null, latencyMs: 40 }] };
  }
  if ((body.apiKey ?? '').includes('bad')) {
    return { ok: false, models: null, steps: [{ step: 'models', ok: false, summary: 'API Key 不对（401）',
      detail: 'Incorrect API key provided', status: 401, latencyMs: 210 }] };
  }
  const listed = { step: 'models' as const, ok: true, summary: `接口列出 ${String(FAKE_LISTED_MODELS.length)} 个模型`,
    detail: null, status: 200, latencyMs: 180 };
  if (body.model === undefined) return { ok: true, models: [...FAKE_LISTED_MODELS], steps: [listed] };
  const known = FAKE_LISTED_MODELS.includes(body.model);
  const reply = known
    ? { step: 'reply' as const, ok: true, summary: `${body.model} 回复了`, detail: 'pong', status: null,
      latencyMs: 820 }
    : { step: 'reply' as const, ok: false, summary: `模型名不对：接口说没有「${body.model}」（404）`,
      detail: `The model \`${body.model}\` does not exist`, status: 404, latencyMs: 300 };
  return { ok: known, models: [...FAKE_LISTED_MODELS], steps: [listed, reply] };
}
