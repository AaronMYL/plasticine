// M5 甲路的写操作在 action-ops / signed-ops 里的 key：撤销节点（普通写操作，带 requestId）；领配对码、改上限、改自迭代
// 策略由本人会话确认（signed-ops）。上限表单的草稿和改上限这个操作同一个 key（`node:<id>:limits`），按节点 id 存进
// sessionStorage（inline-drafts）：切页、重新配对、刷新之后还在，发出去拿到结果才清。

import { Type } from 'typebox';
import { RevokeNodeRequestSchema } from '../api/shared.ts';

export const M5_ACTION_REQUEST_SCHEMAS = [
  Type.Object({ kind: Type.Literal('node_revoke'), nodeId: Type.String(), body: RevokeNodeRequestSchema }),
] as const;

export function nodeRevokeKey(nodeId: string): string {
  return `node:${nodeId}:revoke`;
}

export function nodeLimitsKey(nodeId: string): string {
  return `node:${nodeId}:limits`;
}

export const NODE_CODE_KEY = 'node:new:code';

/** 设备与度量这一页管的操作 key 前缀。 */
export const DEVICE_OP_PREFIXES: readonly string[] = ['node:', 'self:'];
