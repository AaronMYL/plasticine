// /v2/spaces/import、/v2/spaces/export、/v2/render：资料库的导入、导出（transfer/ 做转换），和把界面拼好的整页网页
// 交给云端浏览器出 PDF、长图（桌面客户端自己出，不走这里）。

import {
  ExportSpacesRequestSchema,
  ImportSpacesRequestSchema,
  RenderPageRequestSchema,
  TRANSFER_BODY_MAX_BYTES,
  type ImportSpacesResponse,
} from '../../shared/api/index.ts';
import { exportSpaces, importSpaces } from '../transfer/index.ts';
import { notFoundError } from './api-error.ts';
import { requireAuth, requireUserAuth, type Reply, type RequestContext } from './context.ts';
import { readJsonBody } from './http.ts';
import { idempotent } from './idempotency.ts';
import { transferFiles } from './notes-transfer.ts';
import { spaceListItem } from './space-views.ts';
import { checkInput } from './validate.ts';

/** 出 PDF、长图最多等这么久。 */
const RENDER_TIMEOUT_MS = 90_000;
/** 放进云端浏览器的页面一律不许连网：图和字体只能是页面里自带的。 */
const RENDER_CSP = '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; '
  + "script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data: blob:\">";
const TYPES = { pdf: 'application/pdf', png: 'image/png' } as const;

/** POST /v2/spaces/import */
export async function importSpaceFiles(context: RequestContext): Promise<Reply> {
  requireUserAuth(context);
  const raw = await readJsonBody(context.req, TRANSFER_BODY_MAX_BYTES);
  const body = checkInput(ImportSpacesRequestSchema, raw, '导入资料库');
  const files = transferFiles(body.files);
  const { state } = context.deps;
  return idempotent(context, body.requestId, () => {
    const result = importSpaces(state, files, 'user');
    const response: ImportSpacesResponse = { imported: result.imported.map((space) => spaceListItem(state, space)),
      skipped: result.skipped };
    return { status: 200, body: response };
  });
}

/** POST /v2/spaces/export：Markdown、Word。 */
export async function exportSpaceFiles(context: RequestContext): Promise<Reply> {
  requireAuth(context);
  const body = checkInput(ExportSpacesRequestSchema, await readJsonBody(context.req), '导出资料库');
  const { state } = context.deps;
  for (const id of body.ids) {
    if (state.spaces.get(id)?.deletedAt !== null) throw notFoundError('这个空间');
  }
  const file = exportSpaces(state, body.ids, body.format);
  return { status: 200, bytes: { data: file.data, type: file.type, download: file.name } };
}

function withCsp(html: string): string {
  const head = /<head[^>]*>/i.exec(html);
  return head === null ? `${RENDER_CSP}${html}` : html.replace(head[0], `${head[0]}${RENDER_CSP}`);
}

/** POST /v2/render：PDF、长图。 */
export async function renderPageFile(context: RequestContext): Promise<Reply> {
  requireAuth(context);
  const raw = await readJsonBody(context.req, TRANSFER_BODY_MAX_BYTES);
  const body = checkInput(RenderPageRequestSchema, raw, '导出');
  const data = await context.deps.renderPage(withCsp(body.html), body.format, AbortSignal.timeout(RENDER_TIMEOUT_MS));
  return { status: 200, bytes: { data, type: TYPES[body.format], download: `${body.name}.${body.format}` } };
}
