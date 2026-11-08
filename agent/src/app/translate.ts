// /v2/translate（2026-11-03 沉浸式翻译，第 2 批）：网页段落 → 译文（脑的 PageTranslator 发模型请求、查缓存）；
// /v2/translate/settings：翻译成、显示方式、用词表、总是翻译的网站。付款类页面（设备三条道关死的那类）不翻，服务端
// 再拦一次。2026-11-05：模型跟线用同一个（设置 · AI 里选的默认模型、低推理），单独选翻译模型的接口随旧模型通道删掉。

import {
  SetTranslateSettingsSchema,
  TRANSLATE_BATCH_MAX_CHARS,
  TranslateRequestSchema,
  translateSiteOf,
  type TranslateResponse,
  type TranslateSettingsView,
} from '../../shared/api/translate.ts';
import { isPaymentPage } from '../devices/index.ts';
import { ApiError } from './api-error.ts';
import { withCurrent } from './conflict.ts';
import { requireAuth, type Reply, type RequestContext } from './context.ts';
import { readJsonBody } from './http.ts';
import { checkInput } from './validate.ts';

// 没设时区时「几点能再试」按这个写（和其他后台文案同一个兜底）。
const FALLBACK_TIME_ZONE = 'Asia/Shanghai';

function settingsView(context: RequestContext): TranslateSettingsView {
  const row = context.deps.state.translateSettings.get();
  return { version: row.version, target: row.target, display: row.display, glossary: row.glossary,
    alwaysSites: row.alwaysSites };
}

/** 网站写法规整：主机名小写、去掉 www.、去重，保留他加的先后。写成网址的也认。 */
function normalizeSites(sites: readonly string[]): string[] {
  const seen = new Set<string>();
  for (const site of sites) {
    const host = translateSiteOf(site.includes('://') ? site : `https://${site}`);
    if (host !== null) {
      seen.add(host);
    }
  }
  return [...seen];
}

export function getTranslateSettings(context: RequestContext): Reply {
  requireAuth(context);
  return { status: 200, body: settingsView(context) };
}

export async function setTranslateSettings(context: RequestContext): Promise<Reply> {
  requireAuth(context);
  const body = checkInput(SetTranslateSettingsSchema, await readJsonBody(context.req), '翻译设置');
  const { state } = context.deps;
  withCurrent(
    () => state.translateSettings.set(body.version, { target: body.target, display: body.display,
      glossary: body.glossary, alwaysSites: normalizeSites(body.alwaysSites) }),
    () => settingsView(context),
    () => state.translateSettings.get().version,
  );
  return { status: 200, body: settingsView(context) };
}

/** POST /v2/translate：一批段落，回每段译文；没译成的段落和原因放在 failure 里（仍是 200，缓存命中的照样回）。 */
export async function translatePage(context: RequestContext): Promise<Reply> {
  requireAuth(context);
  const input = checkInput(TranslateRequestSchema, await readJsonBody(context.req), '网页翻译');
  const chars = input.items.reduce((sum, item) => sum + [...item.text].length, 0);
  if (chars > TRANSLATE_BATCH_MAX_CHARS) {
    throw new ApiError(400, 'invalid_request', `一批最多 ${TRANSLATE_BATCH_MAX_CHARS} 字，这批 ${chars} 字，请分批送。`,
      { field: 'items' });
  }
  if (isPaymentPage(input.pageUrl)) {
    const body: TranslateResponse = { model: '', items: [], failure: { code: 'payment_page',
      message: '付款类页面不翻译。', retryAt: null, retryable: false, ids: input.items.map((item) => item.id) } };
    return { status: 200, body };
  }
  const { state } = context.deps;
  const controller = new AbortController();
  const abort = (): void => controller.abort();
  context.res.once('close', abort);
  try {
    const body = await context.deps.translator.translate({
      ...input,
      glossary: state.translateSettings.get().glossary,
      timeZone: state.dailySettings.read().settings.timeZone ?? FALLBACK_TIME_ZONE,
    }, controller.signal);
    return { status: 200, body };
  } finally {
    context.res.off('close', abort);
  }
}
