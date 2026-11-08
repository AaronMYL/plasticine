// 沉浸式翻译（2026-11-03 第 2 批）：一批网页段落的译文、翻译设置、翻译用哪个模型（2026-11-05 跟新内核的模型连接走）。形状在 agent/shared/api/translate.ts。

import type { TranslateApi } from '../client.ts';
import {
  TRANSLATE_MODEL_PATH, TRANSLATE_MODEL_TIMEOUT_MS, TRANSLATE_PATH, TRANSLATE_SETTINGS_PATH, TranslateModelViewSchema,
  TranslateResponseSchema, TranslateSettingsViewSchema, type SetTranslateModelRequest, type SetTranslateSettings,
  type TranslateRequest,
} from '../shared.ts';
import { conflictWith } from './conflict.ts';
import type { Transport } from './transport.ts';

/**
 * 一批翻译最多等这么久：服务端问模型最多 TRANSLATE_MODEL_TIMEOUT_MS（60 秒，从排到并发位算起），再留 15 秒给
 * 服务端排队和网络。沿用默认的 15 秒会让客户端先断开、服务端跟着中止，译好的进不了缓存，重试两次后报错（2026-11-04）。
 */
export const TRANSLATE_REQUEST_TIMEOUT_MS = TRANSLATE_MODEL_TIMEOUT_MS + 15_000;

export class HttpTranslate implements TranslateApi {
  private readonly transport: Transport;
  constructor(transport: Transport) {
    this.transport = transport;
  }
  translate(body: TranslateRequest, signal?: AbortSignal) {
    // 只读：没回来就是没译成，下一次再要（缓存在服务端），不算「结果待核实」。关掉翻译时调用方取消（signal）。
    return this.transport.request({ method: 'POST', path: TRANSLATE_PATH, body, schema: TranslateResponseSchema,
      what: '翻译这一页', lostAs: 'failed', signal, timeoutMs: TRANSLATE_REQUEST_TIMEOUT_MS });
  }
  settings(signal?: AbortSignal) {
    return this.transport.request({ method: 'GET', path: TRANSLATE_SETTINGS_PATH, schema: TranslateSettingsViewSchema,
      what: '读取翻译设置', lostAs: 'failed', signal });
  }
  saveSettings(body: SetTranslateSettings) {
    return this.transport.request({ method: 'PUT', path: TRANSLATE_SETTINGS_PATH, body,
      schema: TranslateSettingsViewSchema, what: '保存翻译设置', lostAs: 'uncertain' });
  }
  model(signal?: AbortSignal) {
    return this.transport.request({ method: 'GET', path: TRANSLATE_MODEL_PATH, schema: TranslateModelViewSchema,
      what: '读取翻译用的模型', lostAs: 'failed', signal });
  }
  saveModel(body: SetTranslateModelRequest) {
    return this.transport.request({ method: 'PUT', path: TRANSLATE_MODEL_PATH, body, schema: TranslateModelViewSchema,
      what: '保存翻译用的模型', lostAs: 'uncertain', refine: conflictWith(TranslateModelViewSchema) });
  }
}
