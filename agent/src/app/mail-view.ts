// 邮件按原样显示（用户 2026-11-04 弹框定）的两个接口：
// - GET /v2/contacts/:id/mail/:mailId：点开一封信的正文。存着的 HTML 已在入库时清洗过，这里再过一遍同一张白名单，同时
//   把 cid: 换成 data:（内嵌图从状态目录读），把远程图换成带签名的服务端代理地址；
// - GET /v2/mail-image?u=&e=&s=：服务端代为取远程图（不要会话：沙箱 iframe 带不了 cookie，凭签名）。

import { MailImageQuerySchema, type MailBodyResponse } from '../../shared/api/index.ts';
import type { InboxMailPart, InboxMessage } from '../../shared/state.ts';
import { keepImageUrl, sanitizeMailHtml, type MailFiles } from '../cloud-tools/index.ts';
import { MailImageError, type MailImageFetcher } from '../cloud-tools/mail-image-fetch.ts';
import type { MailImageSigner } from '../cloud-tools/mail-image-signer.ts';
import { errorCategory, safeLog } from '../shared-log.ts';
import type { StateService } from '../state/index.ts';
import { ApiError, notFoundError } from './api-error.ts';
import { parseInboxContact } from './contact-mail.ts';
import { param, requireAuth, type HandlerResult, type Reply, type RequestContext } from './context.ts';
import { checkInput, queryObject } from './validate.ts';

// 一封信换成 data: 的内嵌图合计上限：单张入库时已限 2 MiB，一封再大页面就沉了，超出的那几张不显示（alt 文字还在）。
const INLINE_TOTAL_MAX_BYTES = 8 * 1024 * 1024;
const INLINE_TYPE = /^image\/(?:png|jpe?g|gif|webp|avif|apng|bmp)$/;
// 代理图在浏览器里缓存一天（地址里的签名每 12 小时换一次）。
const IMAGE_CACHE = 'private, max-age=86400';

export interface MailImages {
  signer: MailImageSigner;
  fetcher: MailImageFetcher;
}

export interface MailViewDeps {
  state: StateService;
  files: MailFiles;
  images: MailImages;
}

function contentIdOf(url: string): string {
  const raw = url.slice('cid:'.length).trim().replace(/^<(.*)>$/, '$1');
  try {
    return decodeURIComponent(raw).toLowerCase();
  } catch (error) {
    if (error instanceof URIError) {
      return raw.toLowerCase();
    }
    throw error;
  }
}

/** cid: → data:（读状态目录里的分段文件，合计有上限）。 */
function inlineResolver(files: MailFiles, parts: readonly InboxMailPart[]): (url: string) => string | null {
  const byId = new Map(parts.map((part) => [part.contentId.toLowerCase(), part]));
  const done = new Map<string, string | null>();
  let budget = INLINE_TOTAL_MAX_BYTES;
  return (url) => {
    const id = contentIdOf(url);
    if (done.has(id)) {
      return done.get(id) ?? null;
    }
    const part = byId.get(id);
    let uri: string | null = null;
    if (part !== undefined && INLINE_TYPE.test(part.type) && part.size <= budget) {
      try {
        uri = `data:${part.type};base64,${files.read(part.path).toString('base64')}`;
        budget -= part.size;
      } catch (error) {
        safeLog('warn', 'mail_inline_missing', { category: errorCategory(error) });
      }
    }
    done.set(id, uri);
    return uri;
  };
}

/** 一封信点开的正文。 */
export function mailBody(deps: MailViewDeps, message: InboxMessage): MailBodyResponse {
  const inline = inlineResolver(deps.files, deps.state.inboxMailParts.forMessage(message.id));
  const image = (url: string): string | null => {
    if (/^cid:/i.test(url)) {
      return inline(url);
    }
    if (/^https?:\/\//i.test(url)) {
      return deps.images.signer.url(url);
    }
    return keepImageUrl(url);
  };
  return {
    id: message.id,
    subject: message.title,
    fromName: message.fromName,
    fromAddress: message.fromAddress,
    toAddress: message.toAddress,
    at: message.receivedAt,
    html: message.bodyHtml === null ? null : sanitizeMailHtml(message.bodyHtml, { image }),
    text: message.body,
    attachments: message.attachments,
  };
}

/** GET /v2/contacts/:id/mail/:mailId：只认这个邮件联系人自己的信。 */
export function getContactMail(context: RequestContext): Reply {
  requireAuth(context);
  const { state, m5b } = context.deps;
  const contact = parseInboxContact(param(context, 'id'));
  const message = state.inboxMessages.get(param(context, 'mailId'));
  if (contact === null || contact.kind !== 'mail' || message === undefined || message.source !== 'email'
    || message.fromAddress.trim().toLowerCase() !== contact.address) {
    throw notFoundError('这封邮件');
  }
  const body = mailBody({ state, files: m5b.cloud.mailFiles, images: m5b.mailImages }, message);
  return { status: 200, body };
}

/** GET /v2/mail-image?u=&e=&s=：签名对、没过期才代取；回的是图片字节，不是 JSON。 */
export async function getMailImage(context: RequestContext): Promise<HandlerResult> {
  const query = checkInput(MailImageQuerySchema, queryObject(context.url.searchParams), '图片地址');
  const { signer, fetcher } = context.deps.m5b.mailImages;
  const verdict = signer.check(query.u, query.e, query.s);
  if (verdict !== 'ok') {
    const expired = verdict === 'expired';
    throw new ApiError(403, expired ? 'signature_expired' : 'signature_invalid',
      expired ? '图片地址过期了。' : '图片地址的签名不对。', { next: '重新打开这封邮件。' });
  }
  // 浏览器不等了（关掉了信）就不再取。
  const gone = new AbortController();
  context.res.on('close', () => gone.abort());
  let image;
  try {
    image = await fetcher.get(query.u, gone.signal);
  } catch (error) {
    if (error instanceof MailImageError) {
      safeLog('warn', 'mail_image_failed', { category: errorCategory(error) });
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
