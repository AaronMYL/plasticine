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

const RENDER_TIMEOUT_MS = 90_000;
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

export async function renderPageFile(context: RequestContext): Promise<Reply> {
  requireAuth(context);
  const raw = await readJsonBody(context.req, TRANSFER_BODY_MAX_BYTES);
  const body = checkInput(RenderPageRequestSchema, raw, '导出');
  const data = await context.deps.renderPage(withCsp(body.html), body.format, AbortSignal.timeout(RENDER_TIMEOUT_MS));
  return { status: 200, bytes: { data, type: TYPES[body.format], download: `${body.name}.${body.format}` } };
}
