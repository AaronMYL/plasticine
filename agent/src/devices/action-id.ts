import { createHash } from 'node:crypto';
import { Value } from 'typebox/value';
import { NodeActionEnvelopeSchema, type NodeActionEnvelope } from '../../shared/api/index.ts';
import type { ActionRequest } from './actions.ts';

// 桌面回执文件的既有上限；编号来自模型工具调用，可能包含分隔符或超过文件名长度。
const SAFE_ACTION_ID = /^[A-Za-z0-9_.:-]{1,200}$/;

export function normalizeActionRequest(request: ActionRequest): ActionRequest {
  if (SAFE_ACTION_ID.test(request.actionId)) { return request; }
  const digest = createHash('sha256').update(request.actionId).digest('hex').slice(0, 40);
  return { ...request, actionId: `a-${digest}`, originalActionId: request.actionId };
}

/** 原工具编号只保存在请求记录里，不扩充发给设备的协议。 */
export function dispatchEnvelope(stored: unknown): NodeActionEnvelope | null {
  if (typeof stored !== 'object' || stored === null) { return null; }
  const { originalActionId: _, ...envelope } = stored as Record<string, unknown>;
  return Value.Check(NodeActionEnvelopeSchema, envelope) ? envelope : null;
}
