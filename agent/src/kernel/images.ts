import type { Models } from '@earendil-works/pi-ai';

export type IllustrationMime = 'image/png' | 'image/webp' | 'image/jpeg';
export type Illustration = { data: Buffer; mime: IllustrationMime } | { error: string };

export interface Illustrator {
  draw(prompt: string, signal: AbortSignal): Promise<Illustration>;
}

const CODEX_URL = 'https://chatgpt.com/backend-api/codex/responses';
const IMAGES_URL = 'https://api.openai.com/v1/images/generations';
const JWT_CLAIM = 'https://api.openai.com/auth';
const SIZE = '1536x1024';
const FORMAT = 'webp';
const IMAGE_MODEL = 'gpt-image-1';
export const ILLUSTRATION_TIMEOUT_MS = 150_000;
const STYLE = '画成手绘墨线加水彩的插画：纸张质感，温暖柔和的光，色调和谐；照描述画具体的场景、人物动作和关键物件，'
  + '细节丰富但不杂乱；画里不要任何文字，不画界面截图，不画人脸特写。';
const INSTRUCTIONS = 'You draw one illustration for a personal letter. Always call the image_generation tool once.';
const CODEX_NAME = 'ChatGPT（Codex）';
const DETAIL_MAX_CHARS = 160;
const MODEL_TTL_MS = 24 * 60 * 60 * 1000;
const PROBE_TIMEOUT_MS = 20_000;
const PROBE_INSTRUCTIONS = 'Reply with the single word OK. Do not call any tool.';
const seenModels = new Map<string, { model: string; at: number }>();

export interface KernelImagesOptions {
  models: Pick<Models, 'getAuth' | 'getModels'>;
  codexModel?: () => string | null;
  fetch?: typeof fetch;
}

function accountId(token: string): string | null {
  const payload = token.split('.')[1];
  if (payload === undefined) return null;
  try {
    const claims: unknown = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    const auth: unknown = typeof claims === 'object' && claims !== null ? Reflect.get(claims, JWT_CLAIM) : null;
    const id: unknown = typeof auth === 'object' && auth !== null ? Reflect.get(auth, 'chatgpt_account_id') : null;
    return typeof id === 'string' && id !== '' ? id : null;
  } catch (error) {
    if (error instanceof SyntaxError) return null;
    throw error;
  }
}

function imageFromEvent(value: unknown): string | null {
  if (typeof value !== 'object' || value === null) return null;
  if (Reflect.get(value, 'type') === 'image_generation_call') {
    const result: unknown = Reflect.get(value, 'result');
    if (typeof result === 'string' && result !== '') return result;
  }
  for (const child of Object.values(value)) {
    const found = imageFromEvent(child);
    if (found !== null) return found;
  }
  return null;
}

function toolModelOf(value: unknown): string | null {
  const response: unknown = typeof value === 'object' && value !== null ? Reflect.get(value, 'response') : null;
  const tools: unknown = typeof response === 'object' && response !== null ? Reflect.get(response, 'tools') : null;
  if (!Array.isArray(tools)) return null;
  for (const tool of tools) {
    const type: unknown = typeof tool === 'object' && tool !== null ? Reflect.get(tool, 'type') : null;
    const model: unknown = type === 'image_generation' ? Reflect.get(tool as object, 'model') : null;
    if (typeof model === 'string' && model !== '') return model;
  }
  return null;
}

async function readSse(response: Response): Promise<{ image: string | null; model: string | null }> {
  const text = await response.text();
  let image: string | null = null;
  let model: string | null = null;
  for (const block of text.split(/\r?\n\r?\n/)) {
    const data = block.split(/\r?\n/).filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).trimStart()).join('\n');
    if (data === '' || data === '[DONE]') continue;
    try {
      const event: unknown = JSON.parse(data);
      image = imageFromEvent(event) ?? image;
      model = toolModelOf(event) ?? model;
    } catch (error) {
      if (!(error instanceof SyntaxError)) throw error;
    }
  }
  return { image, model };
}

async function detailOf(response: Response): Promise<string> {
  const text = await response.text();
  try {
    const json: unknown = JSON.parse(text);
    const error: unknown = typeof json === 'object' && json !== null ? Reflect.get(json, 'error') : null;
    const message: unknown = typeof error === 'object' && error !== null ? Reflect.get(error, 'message')
      : typeof json === 'object' && json !== null ? Reflect.get(json, 'detail') : null;
    return typeof message === 'string' ? message.trim().slice(0, DETAIL_MAX_CHARS) : '';
  } catch (error) {
    if (error instanceof SyntaxError) return '';
    throw error;
  }
}

async function failure(response: Response, route: 'codex' | 'key'): Promise<string> {
  const detail = await detailOf(response);
  const { status } = response;
  if (route === 'codex' && (status === 401 || status === 403)) return `「${CODEX_NAME}」的登录过期了：到 设置 › AI 重新登录`;
  if (route === 'key' && (status === 401 || status === 403)) {
    return `OpenAI 的 API key 不对或没有出图权限${detail === '' ? '' : `：${detail}`}`;
  }
  if (status === 429) return route === 'codex' ? 'ChatGPT 订阅的出图额度用完了，过一阵再试' : '出图额度用完了';
  return `出图接口回了 ${status}${detail === '' ? '' : `：${detail}`}`;
}

export class KernelImages implements Illustrator {
  readonly #options: KernelImagesOptions;

  constructor(options: KernelImagesOptions) {
    this.#options = options;
  }

  async draw(prompt: string, signal: AbortSignal): Promise<Illustration> {
    const timeout = AbortSignal.any([signal, AbortSignal.timeout(ILLUSTRATION_TIMEOUT_MS)]);
    const full = `${prompt}\n${STYLE}`;
    try {
      const codex = await this.#options.models.getAuth('openai-codex');
      if (codex?.auth.apiKey !== undefined) {
        return await this.#codex(codex.auth.apiKey, full, timeout);
      }
      const openai = await this.#options.models.getAuth('openai');
      if (openai?.source === 'OAuth') {
        return { error: `「Sign in with ChatGPT」这种登录 OpenAI 不让出图：在 设置 › AI 里再登录「${CODEX_NAME}」就能出图` };
      }
      if (openai?.auth.apiKey !== undefined) {
        return await this.#images(openai.auth.apiKey, full, timeout);
      }
      return { error: `没有连能出图的登录：在 设置 › AI 里登录「${CODEX_NAME}」，或填 OpenAI 的 API key` };
    } catch (error) {
      if (timeout.aborted) return { error: signal.aborted ? '出图取消了' : '出图超时了' };
      return { error: `出图失败：${error instanceof Error ? error.message : String(error)}` };
    }
  }

  async model(signal: AbortSignal): Promise<string | null> {
    const codex = await this.#options.models.getAuth('openai-codex');
    if (codex?.auth.apiKey !== undefined) {
      return this.#codexModel(codex.auth.apiKey, AbortSignal.any([signal, AbortSignal.timeout(PROBE_TIMEOUT_MS)]));
    }
    const openai = await this.#options.models.getAuth('openai');
    return openai?.source !== 'OAuth' && openai?.auth.apiKey !== undefined ? IMAGE_MODEL : null;
  }

  async #codexModel(token: string, signal: AbortSignal): Promise<string | null> {
    const account = accountId(token);
    const routing = this.#routingModel();
    if (account === null || routing === null) return null;
    const known = seenModels.get(account);
    if (known !== undefined && Date.now() - known.at < MODEL_TTL_MS) return known.model;
    const body = { model: routing, store: false, stream: true, instructions: PROBE_INSTRUCTIONS,
      input: [{ type: 'message', role: 'user', content: [{ type: 'input_text', text: 'OK?' }] }],
      tools: [{ type: 'image_generation', size: SIZE, output_format: FORMAT, quality: 'medium' }],
      tool_choice: 'none' };
    try {
      const response = await this.#post(token, account, body, signal);
      if (!response.ok) return null;
      const { model } = await readSse(response);
      if (model !== null) seenModels.set(account, { model, at: Date.now() });
      return model;
    } catch (error) {
      if (signal.aborted || error instanceof TypeError) return null;
      throw error;
    }
  }

  #post(token: string, account: string, body: object, signal: AbortSignal): Promise<Response> {
    return (this.#options.fetch ?? fetch)(CODEX_URL, { method: 'POST', signal,
      headers: { 'authorization': `Bearer ${token}`, 'chatgpt-account-id': account, 'originator': 'pi',
        'OpenAI-Beta': 'responses=experimental', 'accept': 'text/event-stream', 'content-type': 'application/json' },
      body: JSON.stringify(body) });
  }

  #routingModel(): string | null {
    const chosen = this.#options.codexModel?.() ?? null;
    return chosen ?? this.#options.models.getModels('openai-codex')[0]?.id ?? null;
  }

  async #codex(token: string, prompt: string, signal: AbortSignal): Promise<Illustration> {
    const account = accountId(token);
    const model = this.#routingModel();
    if (account === null || model === null) return { error: 'ChatGPT 订阅的登录信息不全' };
    const body = {
      model, store: false, stream: true, instructions: INSTRUCTIONS,
      input: [{ type: 'message', role: 'user', content: [{ type: 'input_text', text: prompt }] }],
      tools: [{ type: 'image_generation', size: SIZE, output_format: FORMAT, quality: 'medium' }],
      tool_choice: { type: 'allowed_tools', mode: 'required', tools: [{ type: 'image_generation' }] },
    };
    const response = await this.#post(token, account, body, signal);
    if (!response.ok) return { error: await failure(response, 'codex') };
    const { image, model: used } = await readSse(response);
    if (used !== null) seenModels.set(account, { model: used, at: Date.now() });
    return image === null ? { error: '出图接口没给图' } : { data: Buffer.from(image, 'base64'), mime: 'image/webp' };
  }

  async #images(key: string, prompt: string, signal: AbortSignal): Promise<Illustration> {
    const response = await (this.#options.fetch ?? fetch)(IMAGES_URL, { method: 'POST', signal,
      headers: { 'authorization': `Bearer ${key}`, 'content-type': 'application/json' },
      body: JSON.stringify({ model: IMAGE_MODEL, prompt, size: SIZE, output_format: FORMAT, n: 1 }) });
    if (!response.ok) return { error: await failure(response, 'key') };
    const json: unknown = await response.json();
    const first: unknown = typeof json === 'object' && json !== null ? Reflect.get(json, 'data') : null;
    const item: unknown = Array.isArray(first) ? first[0] : null;
    const b64: unknown = typeof item === 'object' && item !== null ? Reflect.get(item, 'b64_json') : null;
    return typeof b64 === 'string' && b64 !== '' ? { data: Buffer.from(b64, 'base64'), mime: 'image/webp' }
      : { error: '出图接口没给图' };
  }
}
