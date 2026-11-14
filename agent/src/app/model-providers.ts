// /v2/model-providers、/v2/model-default：新内核的模型连接，按提供商通用（shared/api/model-providers.ts）。
// 列提供商（连没连、用哪种方式，不回显密钥）、订阅登录（开始 → 授权网址；交回调地址完成；看进度；取消）、填 key、
// 退出、选默认模型。凭证只经 kernel/ 写进库。

import {
  CompleteProviderLoginRequestSchema,
  ProviderCommandRequestSchema,
  SaveModelConfigRequestSchema,
  SetDefaultModelRequestSchema,
  SetProviderKeyRequestSchema,
  StartProviderLoginRequestSchema,
} from '../../shared/api/index.ts';
import { KernelModelError, type KernelModels, type ProviderLogins } from '../kernel/index.ts';
import { ApiError } from './api-error.ts';
import { kernelImagesOf } from './assemble-spaces.ts';
import { param, requireAuth, type Reply, type RequestContext } from './context.ts';
import { readJsonBody } from './http.ts';
import { idempotent, idempotentAsync } from './idempotency.ts';
import { checkInput } from './validate.ts';

export interface KernelModelParts {
  models: KernelModels;
  logins: ProviderLogins;
}

export function parts(context: RequestContext): KernelModelParts {
  requireAuth(context);
  const kernel = context.deps.kernelModels;
  if (kernel === null) {
    throw new ApiError(503, 'not_configured', '新内核的模型连接还没装上。', { next: '更新服务后再试。' });
  }
  return kernel;
}

const MAPPED = { not_found: [404, 'not_found'], invalid: [400, 'invalid_request'],
  conflict: [409, 'conflict'] } as const;

export function mapped(error: unknown): never {
  if (error instanceof KernelModelError) {
    const [status, code] = MAPPED[error.code];
    throw new ApiError(status, code, error.message);
  }
  throw error;
}

export async function guarded<T>(work: () => Promise<T> | T): Promise<T> {
  try {
    return await work();
  } catch (error) {
    return mapped(error);
  }
}

function listBody(kernel: KernelModelParts) {
  return { providers: kernel.models.providers(), chosen: kernel.models.chosen(), effective: kernel.models.effective(),
    defaultIssue: kernel.models.defaultIssue(), ...kernel.models.settings() };
}

export async function saveModelConfig(context: RequestContext): Promise<Reply> {
  const kernel = parts(context);
  const input = checkInput(SaveModelConfigRequestSchema, await readJsonBody(context.req), '模型设置');
  return idempotent(context, input.requestId, () => {
    try {
      kernel.models.configure(input);
    } catch (error) {
      mapped(error);
    }
    return { status: 200, body: listBody(kernel) };
  });
}

/** GET /v2/model-providers */
export function listModelProviders(context: RequestContext): Reply {
  return { status: 200, body: listBody(parts(context)) };
}

/** GET /v2/model-providers/image-model：设置 · AI「出图」那一行写的图片模型（第13批）。 */
export async function getImageModel(context: RequestContext): Promise<Reply> {
  const images = kernelImagesOf(parts(context));
  const gone = new AbortController();
  const close = (): void => gone.abort();
  context.res.once('close', close);
  try {
    return { status: 200, body: { model: images === null ? null : await images.model(gone.signal) } };
  } finally { context.res.removeListener('close', close); }
}

/** POST /v2/model-providers/:id/login：开始订阅登录，回授权网址（或设备码）。 */
export async function startProviderLogin(context: RequestContext): Promise<Reply> {
  const kernel = parts(context);
  const input = checkInput(StartProviderLoginRequestSchema, await readJsonBody(context.req), '登录');
  const providerId = param(context, 'id');
  return idempotentAsync(context, input.requestId, async () => ({ status: 200,
    body: await guarded(() => kernel.logins.start(providerId)) }));
}

/** GET /v2/model-providers/:id/login/:loginId */
export async function getProviderLogin(context: RequestContext): Promise<Reply> {
  const kernel = parts(context);
  return { status: 200, body: await guarded(() => kernel.logins.get(param(context, 'loginId'))) };
}

/** POST /v2/model-providers/:id/login/:loginId/complete：交浏览器跳转到的回调地址（或该家要的代码）。 */
export async function completeProviderLogin(context: RequestContext): Promise<Reply> {
  const kernel = parts(context);
  const input = checkInput(CompleteProviderLoginRequestSchema, await readJsonBody(context.req), '登录');
  const loginId = param(context, 'loginId');
  return idempotentAsync(context, input.requestId, async () => ({ status: 200,
    body: await guarded(() => kernel.logins.complete(loginId, input.input)) }));
}

/** POST /v2/model-providers/:id/login/:loginId/cancel */
export async function cancelProviderLogin(context: RequestContext): Promise<Reply> {
  const kernel = parts(context);
  const input = checkInput(ProviderCommandRequestSchema, await readJsonBody(context.req), '登录');
  const loginId = param(context, 'loginId');
  return idempotentAsync(context, input.requestId, async () => ({ status: 200,
    body: await guarded(() => kernel.logins.cancel(loginId)) }));
}

/** POST /v2/model-providers/:id/key：填 key（只写不读）。 */
export async function setProviderKey(context: RequestContext): Promise<Reply> {
  const kernel = parts(context);
  const input = checkInput(SetProviderKeyRequestSchema, await readJsonBody(context.req), 'key');
  const providerId = param(context, 'id');
  return idempotentAsync(context, input.requestId, async () => {
    await guarded(() => kernel.models.setApiKey(providerId, input.apiKey));
    return { status: 200, body: listBody(kernel) };
  });
}

/** POST /v2/model-providers/:id/logout */
export async function logoutProvider(context: RequestContext): Promise<Reply> {
  const kernel = parts(context);
  const input = checkInput(ProviderCommandRequestSchema, await readJsonBody(context.req), '退出');
  const providerId = param(context, 'id');
  return idempotentAsync(context, input.requestId, async () => {
    await guarded(() => kernel.models.logout(providerId));
    return { status: 200, body: listBody(kernel) };
  });
}

/** POST /v2/model-default */
export async function setDefaultModel(context: RequestContext): Promise<Reply> {
  const kernel = parts(context);
  const input = checkInput(SetDefaultModelRequestSchema, await readJsonBody(context.req), '默认模型');
  return idempotent(context, input.requestId, () => {
    try {
      kernel.models.setDefault({ provider: input.provider, model: input.model,
        ...(input.thinking === undefined ? {} : { thinking: input.thinking }) });
    } catch (error) {
      mapped(error);
    }
    return { status: 200, body: listBody(kernel) };
  });
}
