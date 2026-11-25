import type { ConnectionTestStep, CustomModel, TestModelConnectionRequest, TestModelConnectionResponse }
  from '../shared.ts';

export const FAKE_LISTED_MODELS: readonly { id: string; contextWindow: number | null }[] = [
  { id: 'chat-large', contextWindow: 200_000 }, { id: 'chat-fast', contextWindow: null },
  { id: 'chat-coder', contextWindow: 256_000 }, { id: 'chat-mini', contextWindow: null },
];

function reply(model: CustomModel): ConnectionTestStep {
  const base = { step: 'reply' as const, model: model.id, status: null, latencyMs: 820 };
  if (!FAKE_LISTED_MODELS.some((item) => item.id === model.id)) {
    return { ...base, ok: false, summary: `模型名不对：接口说没有「${model.id}」（404）`,
      detail: `The model \`${model.id}\` does not exist`, status: 404 };
  }
  if (model.reasoning && model.id === 'chat-mini') {
    return { ...base, ok: false, summary: `${model.id} 能回复，但不认思考参数，取消「能思考」`, detail: 'pong' };
  }
  if (model.images && model.id === 'chat-coder') {
    return { ...base, ok: false, summary: `${model.id} 能回复，但不收图片，取消「能看图」`, detail: 'pong' };
  }
  const extras = [model.images ? '带图' : null, model.reasoning ? '较低思考' : null].filter((part) => part !== null);
  return { ...base, ok: true, summary: `${model.id} 回复了${extras.length === 0 ? '' : `（${extras.join(' · ')}）`}`,
    detail: 'pong' };
}

export function fakeConnectionTest(body: TestModelConnectionRequest): TestModelConnectionResponse {
  if (body.baseUrl.includes('nowhere')) {
    return { ok: false, models: null, steps: [{ step: 'models', model: null, ok: false,
      summary: '找不到这个域名，检查 Base URL 有没有拼错', detail: 'ENOTFOUND getaddrinfo ENOTFOUND',
      status: null, latencyMs: 40 }] };
  }
  if ((body.apiKey ?? '').includes('bad')) {
    return { ok: false, models: null, steps: [{ step: 'models', model: null, ok: false, summary: 'API Key 不对（401）',
      detail: 'Incorrect API key provided', status: 401, latencyMs: 210 }] };
  }
  const listed: ConnectionTestStep = { step: 'models', model: null, ok: true,
    summary: `接口列出 ${String(FAKE_LISTED_MODELS.length)} 个模型`, detail: null, status: 200, latencyMs: 180 };
  const models = FAKE_LISTED_MODELS.map((item) => ({ ...item }));
  const replies = (body.models ?? []).map(reply);
  return { ok: replies.every((step) => step.ok), models, steps: [listed, ...replies] };
}
