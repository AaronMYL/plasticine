// M5 甲路的行 → 接口视图（shared/api/devices.ts）：执行节点、设备动作。只挑字段和补标签，不做决定。
// 节点视图里没有凭证散列：散列也不出服务端。

import { DEVICE_KIND_LABELS, NODE_ONLINE_MS, type NodeActionView, type NodeView, type NodeWork }
  from '../../shared/api/index.ts';
import { DEVICE_ACTION_CLASSES, type DeviceNode, type NodeAction } from '../../shared/state.ts';
import { effectiveLimits } from '../devices/index.ts';
import type { StateService } from '../state/index.ts';

// 每小时次数按最近一小时数（devices/actions.ts）。
const HOUR_MS = 60 * 60 * 1000;

/** 11-16：设备的两项状态（连着没有、动作通道在干什么），由 devices/ 的 NodeWorkBoard 给。 */
export interface WorkSource {
  work(nodeId: string): NodeWork;
}

export function nodeView(state: Pick<StateService, 'nodeActions'>, node: DeviceNode, now: Date,
  devices: WorkSource): NodeView {
  const since = new Date(now.getTime() - HOUR_MS).toISOString();
  const usage: Record<string, number> = {};
  for (const actionClass of DEVICE_ACTION_CLASSES) {
    usage[actionClass] = state.nodeActions.countSince(node.id, actionClass, since);
  }
  return {
    id: node.id,
    name: node.name,
    platform: node.platform,
    appVersion: node.appVersion,
    protocolVersion: node.protocolVersion,
    capabilities: node.capabilities,
    pairedAt: node.pairedAt,
    lastSeenAt: node.lastSeenAt,
    revokedAt: node.revokedAt,
    limits: effectiveLimits(node),
    limitsVersion: node.limitsVersion,
    limitsAreDefault: node.limits === null,
    limitsConfirmedAt: node.confirmedByDeviceAt,
    usage,
    online: node.revokedAt === null && now.getTime() - Date.parse(node.lastSeenAt) <= NODE_ONLINE_MS,
    work: devices.work(node.id),
    version: node.version,
  };
}

export function nodeActionView(action: NodeAction): NodeActionView {
  return {
    id: action.id,
    actionId: action.actionId,
    nodeId: action.nodeId,
    kind: action.kind,
    kindLabel: DEVICE_KIND_LABELS[action.kind],
    actionClass: action.actionClass,
    target: action.target,
    status: action.status,
    refusalLayer: action.refusalLayer,
    reason: action.reason,
    origin: action.origin,
    requestedAt: action.requestedAt,
    executedAt: action.executedAt,
    version: action.version,
  };
}
