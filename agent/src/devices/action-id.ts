import { createHash } from 'node:crypto';
import { Value } from 'typebox/value';
import { NodeActionEnvelopeSchema, type NodeActionEnvelope } from '../../shared/api/index.ts';
import type { ActionRequest } from './actions.ts';

const SAFE_ACTION_ID = /^[A-Za-z0-9_.:-]{1,200}$/;

export function normalizeActionRequest(request: ActionRequest): ActionRequest {
  if (SAFE_ACTION_ID.test(request.actionId)) { return request; }
  const digest = createHash('sha256').update(request.actionId).digest('hex').slice(0, 40);
  return { ...request, actionId: `a-${digest}`, originalActionId: request.actionId };
}

export function dispatchEnvelope(stored: unknown): NodeActionEnvelope | null {
  if (typeof stored !== 'object' || stored === null) { return null; }
  const { originalActionId: _, ...envelope } = stored as Record<string, unknown>;
  return Value.Check(NodeActionEnvelopeSchema, envelope) ? envelope : null;
}
