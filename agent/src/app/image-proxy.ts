// 回复里的图（11-14 图片统一，Aaron 弹框选：Plasticine 回复里的图直接显示，经服务端转一道，和信息流一样）：
// GET /v2/image?url= 要会话（界面里的 <img> 同源，带着 cookie）；取法和 /v2/mail-image 同一个 fetcher（只走 http(s)，
// 主机名先解析、内网不取、只收图片、有大小上限）。回的是图片字节，不是 JSON。

import { ImageProxyQuerySchema } from '../../shared/api/index.ts';
import { MailImageError } from '../cloud-tools/mail-image-fetch.ts';
import { errorCategory, safeLog } from '../util/log.ts';
import { ApiError } from './api-error.ts';
import { requireAuth, type HandlerResult, type RequestContext } from './context.ts';
import { checkInput, queryObject } from './validate.ts';

// 浏览器里缓存一天（只给自己的设备，private）。
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
    image = await context.deps.m5b.mailImages.fetcher.get(query.url, gone.signal);
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
    // 直接打开代理地址也只是一张图：不执行任何东西、不带来源。
    'content-security-policy': "default-src 'none'; sandbox",
    'referrer-policy': 'no-referrer',
  });
  context.res.end(image.data);
  return 'streamed';
}
