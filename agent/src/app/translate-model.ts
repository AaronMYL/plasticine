// GET / PUT /v2/translate/model：网页翻译单独选的模型（kernel/translate-model.ts）。读不要签名；改带 requestId 和读到的
// 版本，旧了 409。

import { SetTranslateModelRequestSchema } from '../../shared/api/index.ts';
import { TranslateModel } from '../kernel/index.ts';
import type { Reply, RequestContext } from './context.ts';
import { readJsonBody } from './http.ts';
import { idempotent } from './idempotency.ts';
import { mapped, parts } from './model-providers.ts';
import { checkInput } from './validate.ts';

function translateModel(context: RequestContext): TranslateModel {
  return new TranslateModel(parts(context).models, context.deps.state);
}

/** GET /v2/translate/model */
export function getTranslateModel(context: RequestContext): Reply {
  return { status: 200, body: translateModel(context).view() };
}

/** PUT /v2/translate/model */
export async function setTranslateModel(context: RequestContext): Promise<Reply> {
  const model = translateModel(context);
  const body = checkInput(SetTranslateModelRequestSchema, await readJsonBody(context.req), '翻译模型');
  return idempotent(context, body.requestId, () => {
    try {
      return { status: 200, body: model.choose(body.chosen, body.version) };
    } catch (error) {
      return mapped(error);
    }
  });
}
