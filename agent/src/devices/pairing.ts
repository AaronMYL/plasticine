// 节点的配对、凭证、报到、撤销和上限（《应用架构方案》第 10 节）。配对码由你在 App 上签名领（app/ 验签名），节点拿码换长期
// 凭证；凭证和码都只存散列。撤销只打时间：之后凭证立刻失效、动作一律拒。上限只经 confirmLimits 写（用户确认字段）。

import type { NodeHelloRequest, NodePairRequest } from '../../shared/api/index.ts';
import type { DeviceConfirmation, DeviceLimits, DeviceNode, NodePairingCode } from '../../shared/state.ts';
import type { StateService } from '../state/index.ts';
import { hashSecret, newNodeCode, newNodeCredential, NODE_CODE_TTL_MS, nodeCodeHash } from './credentials.ts';
import { DEFAULT_DEVICE_LIMITS } from './defaults.ts';
import { DeviceError } from './errors.ts';

export type PairingState = Pick<
  StateService,
  'nodes' | 'nodePairingCodes' | 'transaction'
>;

export interface PairingContext {
  state: PairingState;
  now: () => Date;
}

export interface IssuedNodeCode {
  codeId: string;
  /** Plain text: goes into the one answer that shows it, nowhere else. */
  code: string;
  expiresAt: string;
}

export interface PairedNode {
  node: DeviceNode;
  /** Plain text: goes into the one pairing answer, nowhere else. */
  credential: string;
}

export function effectiveLimits(node: DeviceNode): DeviceLimits {
  return node.limits ?? structuredClone(DEFAULT_DEVICE_LIMITS);
}

export function issueNodeCode(context: PairingContext, issuedByDeviceId: string): IssuedNodeCode {
  const code = newNodeCode();
  const expiresAt = new Date(context.now().getTime() + NODE_CODE_TTL_MS).toISOString();
  const issued = context.state.nodePairingCodes.issue({ codeHash: nodeCodeHash(code), expiresAt, issuedByDeviceId });
  return { codeId: issued.id, code, expiresAt };
}

/** The code a node typed, if it exists; the caller counts a miss as a wrong guess. */
export function findNodeCode(context: PairingContext, typed: string): NodePairingCode | undefined {
  return context.state.nodePairingCodes.findByHash(nodeCodeHash(typed));
}

function usableCode(context: PairingContext, code: NodePairingCode): void {
  if (code.usedAt !== null || code.voidedAt !== null) {
    const why = code.usedAt !== null ? '已经用过了，一个码只能用一次' : '已经换成了新码，这个作废了';
    throw new DeviceError('pairing_code_used', `这个配对码${why}。`, { field: 'code' });
  }
  if (Date.parse(code.expiresAt) <= context.now().getTime()) {
    throw new DeviceError('pairing_code_expired', '这个配对码已经过期了（10 分钟内有效）。', { field: 'code' });
  }
}

export function pairNode(context: PairingContext, code: NodePairingCode, request: NodePairRequest): PairedNode {
  usableCode(context, code);
  const { state } = context;
  const at = context.now().toISOString();
  const credential = newNodeCredential();
  const node = state.transaction(() => {
    const created = state.nodes.create({
      name: request.name,
      platform: request.platform,
      appVersion: request.appVersion,
      protocolVersion: request.protocolVersion,
      capabilities: request.capabilities,
      credentialHash: hashSecret(credential),
      pairingCodeId: code.id,
      pairedAt: at,
      lastSeenAt: at,
    });
    state.nodePairingCodes.markUsed(code.id, at, created.id);
    return created;
  });
  return { node, credential };
}

/**
 * The same pairing again (its answer was lost): the credential the node never received is replaced by a new one for
 * the same node. Only the hash was stored, so the first one cannot be sent back.
 */
export function reissueCredential(context: PairingContext, nodeId: string): PairedNode {
  const { state } = context;
  const node = state.nodes.get(nodeId);
  if (node === undefined) {
    throw new DeviceError('not_found', '没有这台节点。');
  }
  if (node.revokedAt !== null) {
    throw new DeviceError('node_revoked', '这个配对码登记的节点已经撤销了，不能再用它配对。', { field: 'code' });
  }
  const credential = newNodeCredential();
  const updated = state.nodes.update(node.id, node.version, { credentialHash: hashSecret(credential) });
  return { node: updated, credential };
}

/** The node a credential belongs to, while it is not revoked; anything else is no node at all. */
export function authenticateNode(context: PairingContext, credential: string): DeviceNode | undefined {
  if (credential === '') {
    return undefined;
  }
  const node = context.state.nodes.findByCredentialHash(hashSecret(credential));
  return node === undefined || node.revokedAt !== null ? undefined : node;
}

export function helloNode(context: PairingContext, node: DeviceNode, hello: NodeHelloRequest): DeviceNode {
  const at = context.now().toISOString();
  return context.state.nodes.update(node.id, node.version, {
    appVersion: hello.appVersion,
    protocolVersion: hello.protocolVersion,
    capabilities: hello.capabilities,
    lastSeenAt: at,
    // 第 102 条「用户在场让路」：旧 App 不报空闲秒数，就清掉旧值，照现状执行。
    idleSeconds: hello.idleSeconds ?? null,
    idleReportedAt: hello.idleSeconds === undefined ? null : at,
  });
}

function requireNode(context: PairingContext, nodeId: string): DeviceNode {
  const node = context.state.nodes.get(nodeId);
  if (node === undefined) {
    throw new DeviceError('not_found', '没有这台节点。');
  }
  return node;
}

/** Revoking twice keeps the first time. */
export function revokeNode(context: PairingContext, nodeId: string, byDeviceId: string): DeviceNode {
  const { state } = context;
  return state.transaction(() => {
    const node = requireNode(context, nodeId);
    if (node.revokedAt !== null) {
      return node;
    }
    const at = context.now().toISOString();
    return state.nodes.update(node.id, node.version, { revokedAt: at });
  });
}

/** 设备上限（用户确认字段）：`expectedVersion` is the limits version the page showed. */
export function setNodeLimits(
  context: PairingContext,
  nodeId: string,
  expectedVersion: number,
  limits: DeviceLimits,
  confirmation: DeviceConfirmation,
): DeviceNode {
  const { state } = context;
  return state.transaction(() => {
    const node = requireNode(context, nodeId);
    if (node.revokedAt !== null) {
      throw new DeviceError('node_revoked', '这台节点已经撤销了，上限不用再改。');
    }
    if (node.limitsVersion !== expectedVersion) {
      const message = '这台节点的上限刚刚在别处改过，你看到的是旧的，这次没有改。';
      throw new DeviceError('version_conflict', message, { currentVersion: node.limitsVersion });
    }
    const next = { limits, limitsVersion: node.limitsVersion + 1 };
    return state.nodes.confirmLimits(node.id, node.version, next, confirmation);
  });
}
