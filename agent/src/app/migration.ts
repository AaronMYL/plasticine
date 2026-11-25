import { createReadStream } from 'node:fs';
import {
  MIGRATION_CHUNK_BYTES, MigrationApplyRequestSchema, MigrationCommandSchema, MigrationExportRequestSchema,
  MigrationImportStartSchema, MigrationUnlockRequestSchema,
} from '../../shared/api/index.ts';
import { MigrationProblem, type MigrationService } from '../system/index.ts';
import { ApiError } from './api-error.ts';
import { param, requireUserAuth, type HandlerResult, type Reply, type RequestContext } from './context.ts';
import { readBinaryBody, readJsonBody } from './http.ts';
import { checkInput } from './validate.ts';

function service(context: RequestContext): MigrationService {
  requireUserAuth(context);
  const migration = context.deps.migration;
  if (migration === null) {
    throw new ApiError(404, 'not_found', '这台没装数据迁移。');
  }
  return migration;
}

async function plainly<T>(work: () => T | Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    if (error instanceof MigrationProblem) {
      const status = error.code === 'busy' || error.code === 'not_ready' ? 409 : 400;
      throw new ApiError(status, status === 409 ? 'conflict' : 'invalid_request', error.message);
    }
    throw error;
  }
}

export function migrationStatus(context: RequestContext): Reply {
  return { status: 200, body: service(context).status() };
}

export async function startExport(context: RequestContext): Promise<Reply> {
  const migration = service(context);
  const body = checkInput(MigrationExportRequestSchema, await readJsonBody(context.req), '导出');
  const status = await plainly(() => migration.startExport(body.requestId, body.mode, body.passphrase ?? null));
  return { status: 200, body: status };
}

export function cancelExport(context: RequestContext): Reply {
  return { status: 200, body: service(context).cancelExport() };
}

export function downloadExport(context: RequestContext): HandlerResult {
  const file = service(context).exportFile();
  if (file === null) {
    throw new ApiError(404, 'not_found', '导出的文件已经没了（只留 24 小时），再导出一次。');
  }
  context.res.writeHead(200, {
    'content-type': 'application/octet-stream',
    'content-length': file.bytes,
    'content-disposition': `attachment; filename*=UTF-8''${encodeURIComponent(file.name)}`,
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    'content-security-policy': "default-src 'none'; sandbox",
  });
  const stream = createReadStream(file.path);
  stream.on('error', () => context.res.destroy());
  context.res.on('close', () => stream.destroy());
  stream.pipe(context.res);
  return 'streamed';
}

export async function startImport(context: RequestContext): Promise<Reply> {
  const migration = service(context);
  const body = checkInput(MigrationImportStartSchema, await readJsonBody(context.req), '导入');
  return { status: 200, body: await plainly(() => migration.startImport(body.requestId, body.name, body.bytes)) };
}

export async function importChunk(context: RequestContext): Promise<Reply> {
  const migration = service(context);
  const offset = Number(param(context, 'offset'));
  if (!Number.isSafeInteger(offset) || offset < 0) {
    throw new ApiError(400, 'invalid_request', '分块的位置不对。');
  }
  const data = await readBinaryBody(context.req, MIGRATION_CHUNK_BYTES);
  return { status: 200, body: { received: await plainly(() => migration.appendChunk(offset, data)) } };
}

export async function completeImport(context: RequestContext): Promise<Reply> {
  const migration = service(context);
  return { status: 200, body: await plainly(() => migration.completeImport()) };
}

export async function unlockImport(context: RequestContext): Promise<Reply> {
  const migration = service(context);
  const body = checkInput(MigrationUnlockRequestSchema, await readJsonBody(context.req), '核对口令');
  return { status: 200, body: await plainly(() => migration.unlock(body.passphrase)) };
}

export async function applyImport(context: RequestContext): Promise<Reply> {
  const migration = service(context);
  const body = checkInput(MigrationApplyRequestSchema, await readJsonBody(context.req), '导入');
  return { status: 200, body: await plainly(() => migration.apply(body.how)) };
}

export async function cancelImport(context: RequestContext): Promise<Reply> {
  const migration = service(context);
  checkInput(MigrationCommandSchema, await readJsonBody(context.req), '取消导入');
  return { status: 200, body: migration.cancelImport() };
}

export async function undoMigration(context: RequestContext): Promise<Reply> {
  const migration = service(context);
  checkInput(MigrationCommandSchema, await readJsonBody(context.req), '退回');
  return { status: 200, body: await plainly(() => migration.undo()) };
}
