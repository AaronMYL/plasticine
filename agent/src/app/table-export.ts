import { makeXlsx } from '../artifacts/index.ts';
import { ExportTableRequestSchema, tableNumber, type FileEntryResponse } from '../../shared/api/index.ts';
import { requireAuth, type Reply, type RequestContext } from './context.ts';
import { readJsonBody } from './http.ts';
import { idempotent } from './idempotency.ts';
import { fileEntryView } from './tool-group-views.ts';
import { checkInput } from './validate.ts';

const FOLDER = '表格';
const NAME_TRIES = 50;

function cell(text: string): string | number {
  return tableNumber(text) ?? text;
}

function baseName(title: string, now: Date): string {
  const clean = title.replace(/[\\/:*?"<>|\r\n\t]+/g, ' ').replace(/^\.+/, '').trim().slice(0, 60);
  return `${clean === '' ? '表格' : clean} ${now.toISOString().slice(0, 10)}`;
}

export async function exportTable(context: RequestContext): Promise<Reply> {
  requireAuth(context);
  const body = checkInput(ExportTableRequestSchema, await readJsonBody(context.req), '下载表格');
  const { workspace } = context.deps.toolGroups.artifacts;
  return idempotent(context, body.requestId, () => {
    const rows = [body.header, ...body.rows.map((row) => row.map(cell)),
      ...(body.total === undefined ? [] : [body.total.map(cell)])];
    const data = makeXlsx([{ name: body.title.slice(0, 31), rows }], false);
    const listing = workspace.list('');
    if (!listing.entries.some((entry) => entry.name === FOLDER && entry.kind === 'directory')) {
      workspace.mkdir(FOLDER);
    }
    const taken = new Set(workspace.list(FOLDER).entries.map((entry) => entry.name));
    const base = baseName(body.title, context.deps.now());
    const names = Array.from({ length: NAME_TRIES }, (_unused, index) =>
      `${base}${index === 0 ? '' : ` (${index + 1})`}.xlsx`);
    const name = names.find((candidate) => !taken.has(candidate)) ?? `${base} ${context.deps.now().getTime()}.xlsx`;
    const response: FileEntryResponse = { entry: fileEntryView(workspace.upload(FOLDER, name, data, false)) };
    return { status: 201, body: response };
  });
}
