import type { TranslateApi } from '../client.ts';
import {
  TRANSLATE_MODEL_PATH, TRANSLATE_MODEL_TIMEOUT_MS, TRANSLATE_PATH, TRANSLATE_SETTINGS_PATH, TranslateModelViewSchema,
  TranslateResponseSchema, TranslateSettingsViewSchema, type SetTranslateModelRequest, type SetTranslateSettings,
  type TranslateRequest,
} from '../shared.ts';
import { conflictWith } from './conflict.ts';
import type { Transport } from './transport.ts';

export const TRANSLATE_REQUEST_TIMEOUT_MS = TRANSLATE_MODEL_TIMEOUT_MS + 15_000;

export class HttpTranslate implements TranslateApi {
  private readonly transport: Transport;
  constructor(transport: Transport) {
    this.transport = transport;
  }
  translate(body: TranslateRequest, signal?: AbortSignal) {
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
