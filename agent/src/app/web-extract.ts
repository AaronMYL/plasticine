import { WebArchiveRequestSchema, WebExtractInputSchema } from '../../shared/api/web-extract.ts';
import { extractWebPage, prepareWebArchive, publishWebArchive, assertWebArchiveDestination, WebExtractError }
  from '../brain/index.ts';
import { MailImageError } from '../cloud-tools/index.ts';
import { ApiError } from './api-error.ts';
import { requireAuth, type Reply, type RequestContext } from './context.ts';
import { readJsonBody, readJsonBodyWithDigest } from './http.ts';
import { idempotent } from './idempotency.ts';
import { spaceView } from './space-views.ts';
import { checkInput } from './validate.ts';

const EXTRACT_TIMEOUT_MS = 120_000;
async function cancelOnClose(context: RequestContext, work: (signal: AbortSignal) => Promise<Reply>): Promise<Reply> {
  const controller = new AbortController();
  const abort = (): void => controller.abort();
  context.res.once('close', abort);
  try { return await work(AbortSignal.any([controller.signal, AbortSignal.timeout(EXTRACT_TIMEOUT_MS)])); }
  catch (cause) {
    if (cause instanceof MailImageError) throw new ApiError(400, 'web_archive_image',
      `图片没有保存：${cause.message} 网页还没有归档。`);
    if (cause instanceof WebExtractError) {
      throw new ApiError(cause.code === 'deleted' ? 409 : 400, `web_extract_${cause.code}`, cause.message);
    }
    throw cause;
  } finally { context.res.off('close', abort); }
}

export async function extractBrowserPage(context: RequestContext): Promise<Reply> {
  requireAuth(context);
  const input = checkInput(WebExtractInputSchema, await readJsonBody(context.req), '网页提取');
  return cancelOnClose(context, async (signal) => ({ status: 200,
    body: await extractWebPage(context.deps.text, input, signal) }));
}

export async function archiveBrowserPage(context: RequestContext): Promise<Reply> {
  requireAuth(context);
  const parsed = await readJsonBodyWithDigest(context.req);
  const input = checkInput(WebArchiveRequestSchema, parsed.value, '网页归档');
  return cancelOnClose(context, async (signal) => {
    assertWebArchiveDestination(context.deps.state, input.url);
    const prepared = await prepareWebArchive(input,
      (url, active) => context.deps.m5b.mailImages.fetcher.get(url, active), signal);
    return idempotent(context, input.requestId, () => ({ status: 200,
      body: { space: spaceView(context.deps.state,
        publishWebArchive(context.deps.state, prepared, context.deps.now())) },
    }), { bodyDigest: parsed.digest });
  });
}
