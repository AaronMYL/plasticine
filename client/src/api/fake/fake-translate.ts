// 假接口的沉浸式翻译（演示和截图用）：设置存在内存里；译文是「〔译〕+ 原文」，几段演示文章有写好的中文。
// 同一段第二次要就当缓存命中。翻译用哪个模型：不选就跟默认模型走（假的模型连接里那个）。

import type { TranslateApi } from '../client.ts';
import { ApiError } from '../errors.ts';
import {
  DEFAULT_TRANSLATE_SETTINGS, type SetTranslateModelRequest, type SetTranslateSettings,
  type TranslateModelView, type TranslateRequest, type TranslateResponse, type TranslateSettingsView,
} from '../shared.ts';
import type { FakeModelProviders } from './fake-model-providers.ts';
import type { FakeSession } from './fake-session.ts';

const DEMO: Readonly<Record<string, string>> = {
  'What a personal agent should remember': '个人 agent 该记住什么',
  'Remember decisions, not transcripts': '记决定，不记流水账',
  'Most agents forget everything the moment a conversation ends.': '大多数 agent 在对话结束的那一刻就把一切都忘了。',
};

export class FakeTranslate implements TranslateApi {
  private readonly session: FakeSession;
  private readonly models: FakeModelProviders;
  private stored: TranslateSettingsView = { version: 0, ...DEFAULT_TRANSLATE_SETTINGS,
    alwaysSites: ['field-notes.dev', 'news.ycombinator.com', 'x.com'] };
  private readonly seen = new Set<string>();

  constructor(session: FakeSession, models: FakeModelProviders) {
    this.session = session;
    this.models = models;
  }

  async translate(body: TranslateRequest): Promise<TranslateResponse> {
    this.session.require();
    const items = body.items.map((item) => {
      const key = `${body.target}\u0000${item.text}`;
      const cached = this.seen.has(key);
      this.seen.add(key);
      return { id: item.id, text: DEMO[item.text.trim()] ?? `〔译〕${item.text}`, cached };
    });
    const model = (await this.model()).effective?.model ?? '没有连接模型';
    return { model, items, failure: null };
  }

  async settings(): Promise<TranslateSettingsView> {
    this.session.require();
    return { ...this.stored, alwaysSites: [...this.stored.alwaysSites] };
  }

  async saveSettings(body: SetTranslateSettings): Promise<TranslateSettingsView> {
    this.session.require();
    if (body.version !== this.stored.version) {
      throw new ApiError({ kind: 'conflict', code: 'version_conflict', message: '翻译设置已在另一处更新，请重新读取。' });
    }
    const sites = [...new Set(body.alwaysSites.map((site) => site.toLowerCase().replace(/^www\./, '')))];
    this.stored = { ...body, alwaysSites: sites, version: body.version + 1 };
    return this.settings();
  }

  async model(): Promise<TranslateModelView> {
    this.session.require();
    const config = await this.models.list();
    const purpose = config.purposes.find((item) => item.purpose === 'translation');
    const chosen = purpose?.chosen.model == null ? null : { ...purpose.chosen.model,
      thinking: purpose.chosen.thinking ?? config.chosen?.thinking ?? 'medium' as const };
    return { chosen, effective: purpose?.effective ?? null, version: config.version };
  }

  async saveModel(body: SetTranslateModelRequest): Promise<TranslateModelView> {
    this.session.require();
    await this.models.saveConfig({ requestId: body.requestId, version: body.version,
      purposes: [{ purpose: 'translation', chosen: { model: body.chosen === null ? null
        : { provider: body.chosen.provider, model: body.chosen.model }, thinking: body.chosen?.thinking ?? null } }] });
    return this.model();
  }
}
