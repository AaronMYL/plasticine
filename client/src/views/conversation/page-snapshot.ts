// 「问这一页」的快照（11-13 Aaron 弹框选「快照卡」：他看到的是这一页当时的样子 + 标题和网址，Plasticine 读截图加页面结构）。
// 发的时候桌面客户端截可见的这一屏，传成一份图片附件，引用末尾加一行写明附件的标识；显示时从引用里认出这是一页网页
// （标题、网址、哪份附件是截图），画成一张卡（page-card.tsx），不再把给 AI 的结构数据露在外面。
// 网页版、手机没有桌面壳截不了图：卡上只有标题和网址。截图或上传出错不拦着发。

import type { AttachmentsApi } from '../../api/client.ts';
import { createRequestId } from '../../api/request-id.ts';
import type { AttachmentView } from '../../api/shared.ts';
import type { CurrentTab } from '../../shell/current-tab-context.ts';
import { hostWebTabs } from '../../shell/host.ts';
import { imageFile } from '../../shell/web-tools.ts';
import { readFileBytes } from '../../state/attachment-bytes.ts';

/** 截图附件的名字开头（后面跟这一页的标题）。 */
export const PAGE_SNAPSHOT_NAME = '网页快照';
const MARKER = /\n〔网页快照：附件 ([A-Za-z0-9_-]{1,80})〕$/;
const REFERENCE_HEAD = '〔当前页〕[';
const WEB_URL = /^https?:\/\/\S+$/;
const TITLE_MAX_CHARS = 60;

/** 引用末尾写明截图是哪份附件的那一行（模型也读得到：截图在附件里）。 */
export function snapshotMarker(attachmentId: string): string {
  return `\n〔网页快照：附件 ${attachmentId}〕`;
}

export function withSnapshot(text: string, attachmentId: string): string {
  return `${text}${snapshotMarker(attachmentId)}`;
}

export interface PageQuoteInfo {
  title: string;
  url: string;
  /** 这一页当时的截图是哪份附件；没截就是 null。 */
  snapshotId: string | null;
  /** 只是指回这一页（整页已经发过一遍），没有带正文。 */
  reference: boolean;
}

/** 这段引用是不是「问这一页」带的一页网页：是就回标题、网址、截图；不是回 null。 */
export function parsePageQuote(text: string): PageQuoteInfo | null {
  const snapshotId = MARKER.exec(text)?.[1] ?? null;
  const lines = text.split('\n');
  const reference = lines[0]?.startsWith(REFERENCE_HEAD) === true;
  const [title, url] = reference ? [lines[1], lines[2]] : [lines[0], lines[1]];
  if (title === undefined || url === undefined || !WEB_URL.test(url.trim())) {
    return null;
  }
  return { title: title.trim() === '' ? url.trim() : title.trim(), url: url.trim(), snapshotId, reference };
}

async function sha256Of(buffer: ArrayBuffer): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', buffer);
  return Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

/** 截这一页可见的这一屏、传成附件。不是网页标签、没有桌面壳、壳不会截图是 null；出错记一句也回 null（不拦着发）。 */
export async function capturePageSnapshot(tab: Pick<CurrentTab, 'id' | 'kind' | 'title' | 'url'>, api: AttachmentsApi)
  : Promise<AttachmentView | null> {
  const bridge = hostWebTabs();
  if (tab.kind !== 'web' || bridge === null || bridge.tool === undefined
    || !(bridge.tools ?? []).includes('capture')) {
    return null;
  }
  try {
    const title = Array.from(tab.title.trim() === '' ? tab.url ?? '' : tab.title.trim()).slice(0, TITLE_MAX_CHARS)
      .join('').replaceAll(/[\\/\n]/g, ' ');
    const file = imageFile(await bridge.tool(tab.id, { kind: 'capture', scope: 'visible' }),
      `${PAGE_SNAPSHOT_NAME} ${title}`.trim());
    const buffer = await readFileBytes(file);
    const view = await api.upload({ requestId: createRequestId(), name: file.name,
      mimeType: file.type === 'image/png' ? 'image/png' : 'image/jpeg', bytes: file.size,
      sha256: await sha256Of(buffer) }, file);
    return view.status === 'ready' ? view : null;
  } catch (cause) {
    console.warn('没截到这一页的快照，这句照常发（卡上只有标题和网址）', cause);
    return null;
  }
}
