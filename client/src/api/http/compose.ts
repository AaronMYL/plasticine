// 预测消息（11-13）：输入建议的流式请求和结果上报。形状在 agent/shared/api/compose.ts；SSE 和笔记续写同一种。

import type { ComposeApi } from '../client.ts';
import { ApiError, badResponseError } from '../errors.ts';
import {
  COMPOSE_OUTCOME_PATH, COMPOSE_PREDICT_PATH, COMPOSE_PREDICT_TIMEOUT_MS, ComposeOutcomeViewSchema,
  ComposePredictStreamEventSchema, type ComposeOutcome, type ComposePredictView, type ComposeTarget,
} from '../shared.ts';
import type { Transport } from './transport.ts';

/** 服务端最多等模型 20 秒，再留 5 秒给网络。 */
const PREDICT_REQUEST_TIMEOUT_MS = COMPOSE_PREDICT_TIMEOUT_MS + 5_000;

export class HttpCompose implements ComposeApi {
  private readonly transport: Transport;
  constructor(transport: Transport) {
    this.transport = transport;
  }

  async predict(target: ComposeTarget, draft: string, onText: (delta: string) => void,
    signal?: AbortSignal): Promise<ComposePredictView> {
    let view: ComposePredictView | null = null;
    let failure: ApiError | null = null;
    await this.transport.stream({ method: 'POST', path: COMPOSE_PREDICT_PATH, body: { target, draft },
      schema: ComposePredictStreamEventSchema, what: '输入建议', lostAs: 'failed',
      timeoutMs: PREDICT_REQUEST_TIMEOUT_MS, signal }, (event) => {
      if (event.type === 'text') {
        onText(event.delta);
      } else if (event.type === 'done') {
        view = event.view;
      } else {
        failure = new ApiError({ kind: 'failed', code: event.error.code, message: event.error.error,
          next: event.error.next, field: event.error.field });
      }
    });
    if (failure !== null) {
      throw failure;
    }
    if (view === null) {
      throw badResponseError('输入建议', '没给最终文字就结束了', false);
    }
    return view;
  }

  async outcome(input: ComposeOutcome): Promise<void> {
    await this.transport.request({ method: 'POST', path: COMPOSE_OUTCOME_PATH, body: input,
      schema: ComposeOutcomeViewSchema, what: '输入建议的结果', lostAs: 'failed' });
  }
}
