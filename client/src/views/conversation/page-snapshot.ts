import type { AttachmentsApi } from '../../api/client.ts';
import { createRequestId } from '../../api/request-id.ts';
import type { AttachmentView } from '../../api/shared.ts';
import type { CurrentTab } from '../../shell/current-tab-context.ts';
import { hostWebTabs } from '../../shell/host.ts';
import { imageFile } from '../../shell/web-tools.ts';
import { readFileBytes } from '../../state/attachment-bytes.ts';

export const PAGE_SNAPSHOT_NAME = '网页快照';
const MARKER = /\n〔网页快照：附件 ([A-Za-z0-9_-]{1,80})〕$/;
const REFERENCE_HEAD = '〔当前页〕[';
const WEB_URL = /^https?:\/\/\S+$/;
const TITLE_MAX_CHARS = 60;

export function snapshotMarker(attachmentId: string): string {
  return `\n〔网页快照：附件 ${attachmentId}〕`;
}

export function withSnapshot(text: string, attachmentId: string): string {
  return `${text}${snapshotMarker(attachmentId)}`;
}

export interface PageQuoteInfo {
  title: string;
  url: string;
  snapshotId: string | null;
  reference: boolean;
}

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
