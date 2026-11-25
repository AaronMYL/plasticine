import {
  RemoveCustomProviderRequestSchema,
  SaveCustomProviderRequestSchema,
  TestModelConnectionRequestSchema,
} from '../../shared/api/index.ts';
import { removeCustomProvider, saveCustomProvider, storedCustomKey, testConnection } from '../kernel/index.ts';
import { param, type Reply, type RequestContext } from './context.ts';
import { readJsonBody } from './http.ts';
import { idempotentAsync } from './idempotency.ts';
import { guarded, listBody, parts } from './model-providers.ts';
import { checkInput } from './validate.ts';

/** POST /v2/model-providers/custom */
export async function saveCustom(context: RequestContext): Promise<Reply> {
  const kernel = parts(context);
  const input = checkInput(SaveCustomProviderRequestSchema, await readJsonBody(context.req), '自定义提供商');
  const { requestId, ...rest } = input;
  return idempotentAsync(context, requestId, async () => {
    await guarded(() => saveCustomProvider(kernel.models, context.deps.state, rest));
    return { status: 200, body: listBody(kernel) };
  });
}

/** POST /v2/model-providers/custom/:id/remove */
export async function removeCustom(context: RequestContext): Promise<Reply> {
  const kernel = parts(context);
  const input = checkInput(RemoveCustomProviderRequestSchema, await readJsonBody(context.req), '删除');
  const providerId = param(context, 'id');
  return idempotentAsync(context, input.requestId, async () => {
    await guarded(() => removeCustomProvider(kernel.models, context.deps.state, providerId));
    return { status: 200, body: listBody(kernel) };
  });
}

export async function testCustomConnection(context: RequestContext): Promise<Reply> {
  const kernel = parts(context);
  const input = checkInput(TestModelConnectionRequestSchema, await readJsonBody(context.req), '测试连接');
  const known = input.providerId === null ? undefined
    : kernel.models.customConfigs().find((config) => config.id === input.providerId);
  const apiKey = input.apiKey ?? (known === undefined ? '' : await storedCustomKey(kernel.models, known.id));
  const gone = new AbortController();
  const close = (): void => gone.abort();
  context.res.once('close', close);
  try {
    const models = input.models?.map((model) => ({ ...model, id: model.id.trim() }));
    const result = await testConnection({ protocol: input.protocol, baseUrl: input.baseUrl, apiKey: apiKey.trim(),
      ...(models === undefined ? {} : { models }) }, kernel.connectionTest, gone.signal);
    return { status: 200, body: result };
  } finally {
    context.res.removeListener('close', close);
  }
}
