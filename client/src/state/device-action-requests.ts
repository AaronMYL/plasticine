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

