import { LinkPreviewQuerySchema } from '../../shared/api/index.ts';
import { PublicFetchError } from '../cloud-tools/index.ts';
import { ApiError } from './api-error.ts';
import { requireAuth, type Reply, type RequestContext } from './context.ts';
import { checkInput, queryObject } from './validate.ts';

/** 只回标题摘要和带签名的封面代理地址，网页正文不进客户端。 */
export async function getLinkPreview(context: RequestContext): Promise<Reply> {
  requireAuth(context);
  const query = checkInput(LinkPreviewQuerySchema, queryObject(context.url.searchParams), '链接地址');
  const gone = new AbortController();
  const close = (): void => gone.abort();
  context.res.once('close', close);
  try {
    const preview = await context.deps.m5b.linkPreviews.get(query.url, gone.signal);
    return { status: 200, body: { ...preview, image: preview.image === null ? null
      : context.deps.m5b.mailImages.signer.url(preview.image) } };
  } catch (cause) {
    if (cause instanceof PublicFetchError) {
      const status = cause.code === 'refused' ? 400 : cause.code === 'timeout' ? 504 : 502;
      throw new ApiError(status, `link_preview_${cause.code}`, cause.message);
    }
    throw cause;
  } finally { context.res.removeListener('close', close); }
}
