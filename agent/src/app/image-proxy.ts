import { ImageProxyQuerySchema } from '../../shared/api/index.ts';
import { MailImageError } from '../cloud-tools/index.ts';
import { errorCategory, safeLog } from '../util/index.ts';
import { ApiError } from './api-error.ts';
import { requireAuth, type HandlerResult, type RequestContext } from './context.ts';
import { checkInput, queryObject } from './validate.ts';

const IMAGE_CACHE = 'private, max-age=86400';

export async function getProxiedImage(context: RequestContext): Promise<HandlerResult> {
  requireAuth(context);
  const query = checkInput(ImageProxyQuerySchema, queryObject(context.url.searchParams), '图片地址');
  if (!/^https?:\/\//i.test(query.url)) {
    throw new ApiError(400, 'image_refused', '只取 http(s) 的图片。');
  }
  const gone = new AbortController();
  context.res.on('close', () => gone.abort());
  let image;
  try {
    image = await context.deps.toolGroups.mailImages.fetcher.get(query.url, gone.signal);
  } catch (error) {
    if (error instanceof MailImageError) {
      safeLog('warn', 'image_proxy_failed', { category: errorCategory(error) });
      throw new ApiError(502, 'upstream_failed', error.message);
    }
    throw error;
  }
  context.res.writeHead(200, {
    'content-type': image.type,
    'content-length': image.data.length,
    'cache-control': IMAGE_CACHE,
    'x-content-type-options': 'nosniff',
    'content-security-policy': "default-src 'none'; sandbox",
    'referrer-policy': 'no-referrer',
  });
  context.res.end(image.data);
  return 'streamed';
}
