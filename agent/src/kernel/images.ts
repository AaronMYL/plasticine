// 出图（第 8 批第 6 条：来信配一张插图，「试试用他连着的 OpenAI 出图」）。pi-ai 1.5 的出图只接了 OpenRouter，没有
// OpenAI 这一路，所以在内核外面包一层，凭证仍从 pi-ai 的 Models 里取（和对话同一份，不另存）：
// - 连着 ChatGPT 订阅（openai-codex）：走 Codex 的 Responses 接口，带 image_generation 工具、要求必须出图，流式读
//   image_generation_call 的 result（base64）；路由模型用订阅里他在用的那个对话模型。
// - 连着 OpenAI API key（openai）：走 Images 接口（/v1/images/generations）。
// 两家都没连、超时、出错都返回一句原因，不抛：出不了图这封信就不配图，不挡写信。

import type { Models } from '@earendil-works/pi-ai';

export type IllustrationMime = 'image/png' | 'image/webp' | 'image/jpeg';
export type Illustration = { data: Buffer; mime: IllustrationMime } | { error: string };

/** 照画面描述画一张横幅插图。 */
export interface Illustrator {
  draw(prompt: string, signal: AbortSignal): Promise<Illustration>;
}

const CODEX_URL = 'https://chatgpt.com/backend-api/codex/responses';
const IMAGES_URL = 'https://api.openai.com/v1/images/generations';
const JWT_CLAIM = 'https://api.openai.com/auth';
// 来信的插图是横幅（设计稿 600 宽的信纸外扩到 720 × 360）；webp 比 png 小一个量级。
const SIZE = '1536x1024';
const FORMAT = 'webp';
const IMAGE_MODEL = 'gpt-image-1';
// 一张图通常一分钟内出来；再久就当这次出不了。
export const ILLUSTRATION_TIMEOUT_MS = 150_000;
const STYLE = '画成安静、温暖的编辑插画：柔和的光，暖米和暖墨为主，少量陶土色点缀；没有文字、没有界面截图、没有人脸特写。';
const INSTRUCTIONS = 'You draw one illustration for a personal letter. Always call the image_generation tool once.';

export interface KernelImagesOptions {
  models: Pick<Models, 'getAuth' | 'getModels'>;
  /** 订阅那一路的路由模型（他在用的 openai-codex 对话模型）；不给就用目录里第一个。 */
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

/** SSE 里每个 data: 的 JSON；找 image_generation_call 的 result。 */
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

async function readSse(response: Response): Promise<string | null> {
  const text = await response.text();
  let found: string | null = null;
  for (const block of text.split(/\r?\n\r?\n/)) {
    const data = block.split(/\r?\n/).filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).trimStart()).join('\n');
    if (data === '' || data === '[DONE]') continue;
    try {
      found = imageFromEvent(JSON.parse(data)) ?? found;
    } catch (error) {
      if (!(error instanceof SyntaxError)) throw error;
    }
  }
  return found;
}

function failure(status: number): string {
  if (status === 401 || status === 403) return '出图的登录失效或没有权限';
  if (status === 429) return '出图额度用完了';
  return `出图接口回了 ${status}`;
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
      if (openai?.auth.apiKey !== undefined) {
        return await this.#images(openai.auth.apiKey, full, timeout);
      }
      return { error: '没有连能出图的模型（ChatGPT 订阅或 OpenAI API key）' };
    } catch (error) {
      if (timeout.aborted) return { error: signal.aborted ? '出图取消了' : '出图超时了' };
      return { error: `出图失败：${error instanceof Error ? error.message : String(error)}` };
    }
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
    const response = await (this.#options.fetch ?? fetch)(CODEX_URL, { method: 'POST', signal,
      headers: { 'authorization': `Bearer ${token}`, 'chatgpt-account-id': account, 'originator': 'pi',
        'OpenAI-Beta': 'responses=experimental', 'accept': 'text/event-stream', 'content-type': 'application/json' },
      body: JSON.stringify(body) });
    if (!response.ok) return { error: failure(response.status) };
    const image = await readSse(response);
    return image === null ? { error: '出图接口没给图' } : { data: Buffer.from(image, 'base64'), mime: 'image/webp' };
  }

  async #images(key: string, prompt: string, signal: AbortSignal): Promise<Illustration> {
    const response = await (this.#options.fetch ?? fetch)(IMAGES_URL, { method: 'POST', signal,
      headers: { 'authorization': `Bearer ${key}`, 'content-type': 'application/json' },
      body: JSON.stringify({ model: IMAGE_MODEL, prompt, size: SIZE, output_format: FORMAT, n: 1 }) });
    if (!response.ok) return { error: failure(response.status) };
    const json: unknown = await response.json();
    const first: unknown = typeof json === 'object' && json !== null ? Reflect.get(json, 'data') : null;
    const item: unknown = Array.isArray(first) ? first[0] : null;
    const b64: unknown = typeof item === 'object' && item !== null ? Reflect.get(item, 'b64_json') : null;
    return typeof b64 === 'string' && b64 !== '' ? { data: Buffer.from(b64, 'base64'), mime: 'image/webp' }
      : { error: '出图接口没给图' };
  }
}
