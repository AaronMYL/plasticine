import { Type } from 'typebox';
import { OutboundGrantInputSchema, OutboundGrantPatchSchema, OutboundGrantSchema, OutboundLogSchema,
  OutboundResultSchema, type OutboundGrant, type OutboundGrantInput, type OutboundGrantPatch,
  type OutboundLog, type OutboundResult, type OutboundSpec } from '../../shared/outbound.ts';
import type { DeviceConfirmation } from '../../shared/state.ts';
import { checked, RECORD_META_COLUMNS, type ColumnMap } from './codec.ts';
import { requireConfirmation } from './confirmed-fields.ts';
import { StateError } from './errors.ts';
import { allPages, ObjectStore, type StoreContext, type StoreSpec } from './object-store.ts';
import type { Row } from './db.ts';
import { MAIN_LINE_ID } from './lines.ts';

const InternalInput = Type.Object({ ...OutboundGrantInputSchema.properties,
  sourceAskId: Type.Union([Type.String(), Type.Null()]), legacyScheduleId: Type.Union([Type.String(), Type.Null()]),
  confirmedByDeviceId: Type.String(), confirmedAt: Type.String(),
}, { additionalProperties: false });
const InternalPatch = Type.Partial(Type.Object({ ...OutboundGrantPatchSchema.properties,
  revokedAt: Type.Union([Type.String(), Type.Null()]), confirmedByDeviceId: Type.String(), confirmedAt: Type.String(),
}, { additionalProperties: false }));
const COLUMNS: ColumnMap = { ...RECORD_META_COLUMNS,
  actor: 'text', channel: 'text', account: 'text', recipientMode: 'text', recipients: 'json', category: 'text',
  fixedTexts: 'json', scope: 'json', expiresAt: 'text', enabled: 'boolean', revokedAt: 'text', usedCount: 'integer',
  lastUsedAt: 'text', confirmedByDeviceId: 'text', confirmedAt: 'text', sourceAskId: 'text', legacyScheduleId: 'text' };
const SPEC: StoreSpec<typeof OutboundGrantSchema, typeof InternalInput, typeof InternalPatch> = {
  table: 'outbound_grants', schema: OutboundGrantSchema, input: InternalInput, patch: InternalPatch, columns: COLUMNS,
  defaults: { enabled: true, revokedAt: null, usedCount: 0, lastUsedAt: null },
};

function validate(input: OutboundGrantInput): void {
  checked(OutboundGrantInputSchema, input, 'invalid_input', '对外授权');
  if (input.recipientMode === 'list' && input.recipients.length === 0) {
    throw new StateError('invalid_input', '名单授权至少需要一个对象。');
  }
  if (input.scope.kind === 'task' && input.scope.binding.kind === 'line'
    && input.scope.binding.id === MAIN_LINE_ID) {
    throw new StateError('invalid_input', '任务期间需要绑定具体任务、定时任务或项目，不能绑定常驻主线。');
  }
}

function logOf(row: Row): OutboundLog {
  return checked(OutboundLogSchema, {
    id: row.id, grantId: row.grant_id, actor: row.actor, lineId: row.line_id, toolCallId: row.tool_call_id,
    toolName: row.tool_name, argsDigest: row.args_digest, channel: row.channel, account: row.account,
    recipients: JSON.parse(String(row.recipients)), category: row.category, content: row.content,
    status: row.status, summary: row.summary, sourceRef: row.source_ref,
    createdAt: row.created_at, finishedAt: row.finished_at,
  }, 'invalid_input', '对外记录');
}

export interface OutboundCall {
  actor: string; lineId: string; toolCallId: string; toolName: string; argsDigest: string;
}

export function createOutboundStores(context: StoreContext) {
  const store = new ObjectStore(context, SPEC);
  const { db } = context;
  const logGet = (id: string): OutboundLog | undefined => {
    const row = db.get('SELECT * FROM outbound_log WHERE id = $id', { id });
    return row === undefined ? undefined : logOf(row);
  };
  const forCall = (lineId: string, toolCallId: string): OutboundLog | undefined => {
    const row = db.get('SELECT * FROM outbound_log WHERE line_id = $line AND tool_call_id = $call',
      { line: lineId, call: toolCallId });
    return row === undefined ? undefined : logOf(row);
  };
  return {
    outboundGrants: {
      get: store.get.bind(store), require: store.require.bind(store),
      list: (): OutboundGrant[] => allPages((page) => store.select('1 = 1', {}, page, 'created_at DESC, id')),
      bySchedule: (id: string): OutboundGrant | undefined =>
        store.select('legacy_schedule_id = $id', { id }, { limit: 1 })[0],
      create(input: OutboundGrantInput, confirmation: DeviceConfirmation,
        source: { askId?: string; legacyScheduleId?: string } = {}): OutboundGrant {
        validate(input);
        const confirmed = requireConfirmation(confirmation);
        return store.create({ ...input, confirmedAt: confirmed.confirmedAt, confirmedByDeviceId: confirmed.deviceId,
          sourceAskId: source.askId ?? null, legacyScheduleId: source.legacyScheduleId ?? null });
      },
      edit(id: string, version: number, patch: OutboundGrantPatch, confirmation: DeviceConfirmation): OutboundGrant {
        checked(OutboundGrantPatchSchema, patch, 'invalid_input', '修改授权');
        const confirmed = requireConfirmation(confirmation);
        const before = store.require(id);
        if (before.revokedAt !== null) { throw new StateError('invalid_input', '已经撤销的授权不能恢复。'); }
        if (before.legacyScheduleId !== null && Object.keys(patch).some((key) => key !== 'enabled')) {
          throw new StateError('invalid_input', '原定时任务的授权只能停用或撤销；要扩大范围请新建授权。');
        }
        const { actor, channel, account, recipientMode, recipients, category, fixedTexts, scope, expiresAt } = before;
        const { enabled: _, ...rules } = patch;
        validate({ actor, channel, account, recipientMode, recipients, category,
          fixedTexts, scope, expiresAt, ...rules });
        return store.update(id, version, { ...patch,
          confirmedAt: confirmed.confirmedAt, confirmedByDeviceId: confirmed.deviceId });
      },
      revoke(id: string, version: number, confirmation: DeviceConfirmation): OutboundGrant {
        requireConfirmation(confirmation);
        return store.update(id, version, { revokedAt: context.now(), enabled: false });
      },
      /** 验证过的版本和单次额度一起消费，并写日志；没有异步窗口。 */
      claim(grant: OutboundGrant, call: OutboundCall, spec: OutboundSpec): OutboundLog | null {
        return db.transaction(() => {
          if (forCall(call.lineId, call.toolCallId) !== undefined) { return null; }
          const at = context.now();
          const changed = db.run(`UPDATE outbound_grants SET used_count = used_count + 1, last_used_at = $at,
            updated_at = $at, version = version + 1 WHERE id = $id AND version = $version AND enabled = 1
            AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at > $at)
            AND (json_extract(scope, '$.kind') != 'once' OR used_count = 0)`,
          { id: grant.id, version: grant.version, at });
          if (changed === 0) { return null; }
          const id = context.newId();
          db.run(`INSERT INTO outbound_log (id, grant_id, actor, line_id, tool_call_id, tool_name, args_digest,
            channel, account, recipients, category, content, status, summary, source_ref, created_at)
            VALUES ($id, $grant, $actor, $line, $call, $tool, $digest, $channel, $account, $recipients,
              $category, $content, 'pending', '已放行，尚未取得执行结果。', NULL, $at)`, {
            id, grant: grant.id, actor: call.actor, line: call.lineId, call: call.toolCallId,
            tool: call.toolName, digest: call.argsDigest, ...spec, recipients: JSON.stringify(spec.recipients), at,
          });
          return logGet(id)!;
        });
      },
    },
    outboundLog: {
      get: logGet, forCall,
      recoverPending(): number {
        return db.run(`UPDATE outbound_log SET status = 'unknown', finished_at = $at,
          summary = '服务重启前已放行，但没有执行回执；请先核实，没有重复执行。' WHERE status = 'pending'`,
        { at: context.now() });
      },
      bySource: (source: string): OutboundLog[] =>
        db.all('SELECT * FROM outbound_log WHERE source_ref = $source', { source }).map(logOf),
      list: (grantId: string | null = null): OutboundLog[] => db.all(`SELECT * FROM outbound_log
        ${grantId === null ? '' : 'WHERE grant_id = $grant'} ORDER BY created_at DESC, id DESC LIMIT 500`,
      grantId === null ? {} : { grant: grantId }).map(logOf),
      finish(id: string, result: OutboundResult): OutboundLog {
        checked(OutboundResultSchema, result, 'invalid_input', '对外执行结果');
        db.run(`UPDATE outbound_log SET status = $status, summary = $summary, source_ref = $ref, finished_at = $at
          WHERE id = $id AND status IN ('pending', 'queued', 'unknown')`,
        { id, status: result.status, summary: result.summary, ref: result.sourceRef, at: context.now() });
        const row = logGet(id);
        if (row === undefined) { throw new StateError('not_found', '没有这条对外记录。'); }
        return row;
      },
    },
  };
}
