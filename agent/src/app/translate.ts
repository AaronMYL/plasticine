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

const FALLBACK_TIME_ZONE = 'Asia/Shanghai';

function settingsView(context: RequestContext): TranslateSettingsView {
  const row = context.deps.state.translateSettings.get();
  return { version: row.version, target: row.target, display: row.display, glossary: row.glossary,
    alwaysSites: row.alwaysSites };
}

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
