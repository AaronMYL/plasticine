import {
  CreateBackupRequestSchema,
  RestorePreviewRequestSchema,
  RestoreBackupRequestSchema,
  type RestorePreview,
} from '../../shared/api/index.ts';
import { ApiError } from './api-error.ts';
import { requireAuth, requireUserAuth, param, type RequestContext, type Reply } from './context.ts';
import { readJsonBodyWithDigest } from './http.ts';
import { idempotent } from './idempotency.ts';
import { userConfirmation } from './user-confirmation.ts';
import { checkInput } from './validate.ts';
export function listBackups(context: RequestContext): Reply {
  requireAuth(context);
  return {
    status: 200,
    body: {
      backups: context.deps.state.backups.list().map((row) => {
        if (row.objectCount !== undefined || row.status !== 'ready') {
          return row;
        }
        const detail = context.deps.state.backups.detail(row.id);
        return detail.valid ? { ...row,
          objectCount: Object.values(detail.counts).reduce((sum, count) => sum + count, 0),
        } : row;
      }),
      retentionDays: 30,
      schedule: '上海时区每天一份，服务运行后自动补当天；只清理本功能登记且已满 30 天的备份。',
    },
  };
}
export function getBackup(context: RequestContext): Reply {
  requireAuth(context);
  return { status: 200, body: context.deps.state.backups.detail(param(context, 'id')) };
}
export async function createBackup(context: RequestContext): Promise<Reply> {
  requireAuth(context);
  const raw = await readJsonBodyWithDigest(context.req);
  const body = checkInput(CreateBackupRequestSchema, raw.value, '生成本机备份');
  return idempotent(
    context,
    body.requestId,
    (after) => ({ status: 202, body: context.deps.backups.create(body.requestId, 'manual', after) }),
    { bodyDigest: raw.digest },
  );
}
export function getRestorePreview(context: RequestContext): Reply {
  requireAuth(context);
  const row = context.deps.backups.view(param(context, 'previewId'));
  return { status: 200, body: row };
}
export async function previewRestore(context: RequestContext): Promise<Reply> {
  requireAuth(context);
  const raw = await readJsonBodyWithDigest(context.req);
  const body = checkInput(RestorePreviewRequestSchema, raw.value, '预览恢复');
  const id = param(context, 'id');
  return idempotent(
    context,
    body.requestId,
    (after) => ({
      status: 200,
      body: context.deps.backups.preview(id, body.requestId, body.kind, body.objectId, after),
    }),
    { bodyDigest: raw.digest },
  );
}
export async function restoreBackup(context: RequestContext): Promise<Reply> {
  requireUserAuth(context);
  const raw = await readJsonBodyWithDigest(context.req);
  const body = checkInput(RestoreBackupRequestSchema, raw.value, '确认按对象恢复');
  const proof = userConfirmation(context);
  const row: RestorePreview = context.deps.backups.view(body.previewId);
  if (row.backupId !== param(context, 'id') || row.backupName !== body.backupName || row.digest !== body.digest) {
    throw new ApiError(409, 'version_conflict', '备份、名称或预览摘要不匹配。');
  }
  // 一致快照不能嵌套在写事务内；核对本人会话后先留当前快照，提交时再次校验会话、对象基准及卡版本。
  context.deps.backups.safetyCopy(row.id);
  return idempotent(
    context,
    body.requestId,
    (after) => ({ status: 200, body: context.deps.backups.restore(row.backupId, body, proof, after) }),
    { bodyDigest: raw.digest },
  );
}
