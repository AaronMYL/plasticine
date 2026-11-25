import {
  NodeActionInputSchema,
  NodeActionPatchSchema,
  NodeActionSchema,
  type DeviceActionClass,
  type NodeAction,
  type NodeActionInput,
  type NodeActionPatch,
  type Page,
} from '../../shared/state.ts';
import { checked, RECORD_META_COLUMNS, type ColumnMap } from './codec.ts';
import { MAX_PAGE_SIZE, ObjectStore, type StoreContext, type StoreSpec } from './object-store.ts';

const COLUMNS: ColumnMap = {
  ...RECORD_META_COLUMNS,
  actionId: 'text',
  nodeId: 'text',
  kind: 'text',
  actionClass: 'text',
  target: 'text',
  paramsDigest: 'text',
  status: 'text',
  origin: 'text',
  requestedAt: 'text',
  refusalLayer: 'text',
  reason: 'text',
  result: 'json',
  taskId: 'text',
  runId: 'text',
  deliveredAt: 'text',
  executedAt: 'text',
  envelope: 'json',
  deadline: 'text',
  reportDigest: 'text',
  purpose: 'text',
};

const SPEC: StoreSpec<typeof NodeActionSchema, typeof NodeActionInputSchema, typeof NodeActionPatchSchema> = {
  table: 'node_actions',
  schema: NodeActionSchema,
  input: NodeActionInputSchema,
  patch: NodeActionPatchSchema,
  columns: COLUMNS,
  defaults: { purpose: null },
};

const COUNTED = "('queued', 'sent', 'executed', 'failed', 'unknown', 'dry_run')";

export function createNodeActionStore(context: StoreContext) {
  const store = new ObjectStore(context, SPEC);
  return {
    record: (input: NodeActionInput): NodeAction => store.create(input),
    get: store.get.bind(store),
    byActionId(actionId: string): NodeAction | undefined {
      return store.select('action_id = $action_id', { action_id: actionId })[0];
    },
    pending(): NodeAction[] {
      return context.db.all("SELECT id FROM node_actions WHERE status IN ('queued', 'sent') " +
        'ORDER BY requested_at ASC, id ASC').map((row) => store.require(String(row['id'])));
    },
    unreportedWithLaterReceipt(): NodeAction[] {
      return context.db.all(`SELECT missing.id FROM node_actions missing
        WHERE missing.status IN ('sent', 'unknown') AND missing.report_digest IS NULL
          AND EXISTS (SELECT 1 FROM node_actions later WHERE later.node_id = missing.node_id
            AND later.id != missing.id AND later.report_digest IS NOT NULL
            AND later.executed_at > COALESCE(missing.delivered_at, missing.requested_at))`)
        .map((row) => store.require(String(row['id'])));
    },
    update: (id: string, expectedVersion: number, patch: NodeActionPatch): NodeAction =>
      store.update(id, expectedVersion, patch),
    /** How many actions of this class went out to the node since `since` (the per-hour limit). */
    countSince(nodeId: string, actionClass: DeviceActionClass, since: string): number {
      const at = checked(NodeActionSchema.properties.requestedAt, since, 'invalid_input', '数设备动作的起点');
      const row = context.db.get(
        `SELECT count(*) AS n FROM node_actions WHERE node_id = $node_id AND action_class = $action_class
          AND requested_at >= $since AND status IN ${COUNTED}`,
        { node_id: nodeId, action_class: actionClass, since: new Date(at).toISOString() },
      );
      return Number(row?.['n'] ?? 0);
    },
    forTaskNode(taskId: string, nodeId: string): NodeAction[] {
      return store.select('task_id = $task_id AND node_id = $node_id', { task_id: taskId, node_id: nodeId },
        { limit: MAX_PAGE_SIZE }, 'requested_at ASC, id ASC');
    },
    forRunNode(runId: string, nodeId: string): NodeAction[] {
      return store.select('run_id = $run_id AND node_id = $node_id', { run_id: runId, node_id: nodeId },
        { limit: MAX_PAGE_SIZE }, 'requested_at DESC, rowid DESC').reverse();
    },
    latestOfKinds(nodeId: string, kinds: readonly string[], since: string): NodeAction | undefined {
      const names = kinds.map((_, index) => `$kind${index}`).join(', ');
      const params = Object.fromEntries(kinds.map((kind, index) => [`kind${index}`, kind]));
      return store.select(`node_id = $node_id AND kind IN (${names}) AND requested_at >= $since
          AND status IN ('queued', 'sent', 'executed', 'failed', 'unknown')`,
        { node_id: nodeId, since, ...params }, { limit: 1 }, 'requested_at DESC, id DESC')[0];
    },
    trimResults(before: string, limit: number): number {
      return context.db.run(`UPDATE node_actions SET result = NULL WHERE id IN (
        SELECT id FROM node_actions WHERE requested_at < $before AND result IS NOT NULL
          AND status IN ('executed', 'failed', 'refused', 'dry_run') LIMIT $limit)`, { before, limit });
    },
    /** Newest first; with a node id only that node's. */
    recent(nodeId: string | null, page: Page = {}): NodeAction[] {
      if (nodeId === null) {
        return store.select('1 = 1', {}, page, 'requested_at DESC, id DESC');
      }
      return store.select('node_id = $node_id', { node_id: nodeId }, page, 'requested_at DESC, id DESC');
    },
  };
}

export type NodeActionStore = ReturnType<typeof createNodeActionStore>;
