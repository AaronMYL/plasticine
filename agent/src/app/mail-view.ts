import { MailImageQuerySchema, type MailBodyResponse } from '../../shared/api/index.ts';
import type { InboxMailPart, InboxMessage } from '../../shared/state.ts';
import {
  keepImageUrl, MailImageError, sanitizeMailHtml, type MailFiles, type MailImageFetcher, type MailImageSigner,
} from '../cloud-tools/index.ts';
import { errorCategory, safeLog } from '../util/index.ts';
import type { StateService } from '../state/index.ts';
import { ApiError, notFoundError } from './api-error.ts';
import { parseInboxContact } from './contact-mail.ts';
import { param, requireAuth, type HandlerResult, type Reply, type RequestContext } from './context.ts';
import { checkInput, queryObject } from './validate.ts';

const INLINE_TOTAL_MAX_BYTES = 8 * 1024 * 1024;
const INLINE_TYPE = /^image\/(?:png|jpe?g|gif|webp|avif|apng|bmp)$/;
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

export function getContactMail(context: RequestContext): Reply {
  requireAuth(context);
  const { state, toolGroups } = context.deps;
  const contact = parseInboxContact(param(context, 'id'));
  const message = state.inboxMessages.get(param(context, 'mailId'));
  if (contact === null || contact.kind !== 'mail' || message === undefined || message.source !== 'email'
    || message.fromAddress.trim().toLowerCase() !== contact.address) {
    throw notFoundError('这封邮件');
  }
  const body = mailBody({ state, files: toolGroups.cloud.mailFiles, images: toolGroups.mailImages }, message);
  return { status: 200, body };
}

export async function getMailImage(context: RequestContext): Promise<HandlerResult> {
  const query = checkInput(MailImageQuerySchema, queryObject(context.url.searchParams), '图片地址');
  const { signer, fetcher } = context.deps.toolGroups.mailImages;
  const verdict = signer.check(query.u, query.e, query.s);
  if (verdict !== 'ok') {
    const expired = verdict === 'expired';
    throw new ApiError(403, expired ? 'signature_expired' : 'signature_invalid',
      expired ? '图片地址过期了。' : '图片地址的签名不对。', { next: '重新打开这封邮件。' });
  }
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
    'content-security-policy': "default-src 'none'; sandbox",
    'referrer-policy': 'no-referrer',
  });
  context.res.end(image.data);
  return 'streamed';
}
