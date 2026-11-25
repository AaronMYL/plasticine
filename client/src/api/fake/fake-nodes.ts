import type { NodesApi } from '../client.ts';
import { ApiError, ConflictError } from '../errors.ts';
import type {
  DeviceActionParams,
  DeviceLimits,
  NodeActionView,
  NodeListResponse,
  NodePairingCodeResponse,
  NodeView,
  RevokeNodeRequest,
  SetNodeLimitsRequest,
} from '../types.ts';
import type { FakeEventBus } from './event-bus.ts';
import { faultError, type FaultPlan } from './faults.ts';
import type { FakeSession } from './fake-session.ts';
import type { FakeReceipts } from './receipts.ts';

export interface FakeNodesDeps {
  session: FakeSession;
  bus: FakeEventBus;
  receipts: FakeReceipts;
  faults: FaultPlan;
  now: () => Date;
}

export const FAKE_DEFAULT_LIMITS: DeviceLimits = {
  roots: [],
  apps: [],
  sites: [],
  unattendedInput: true,
  classes: {
    read: { mode: 'allow', perHour: 600 },
    write: { mode: 'allow', perHour: 120 },
    delete: { mode: 'confirm_each', perHour: 20 },
    command: { mode: 'allow', perHour: 60 },
    browser: { mode: 'allow', perHour: 300 },
    input: { mode: 'allow', perHour: 600 },
  },
};

const PROTECTED = ['~/.ssh/**（密钥）', '/etc/**（文件系统）', '**/self-iteration-policy.json（更新策略）'];
const CODE_PREFIX = 'K7QM';

function notFound(): ApiError {
  return new ApiError({ kind: 'not_found', code: 'not_found', message: '没有这台节点。', status: 404 });
}

export class FakeNodes implements NodesApi {
  private readonly deps: FakeNodesDeps;
  private readonly nodes = new Map<string, NodeView>();
  private readonly log: NodeActionView[] = [];
  private sequence = 0;

  constructor(deps: FakeNodesDeps) {
    this.deps = deps;
  }

  async list(): Promise<NodeListResponse> {
    this.deps.session.require();
    this.readFault();
    return { nodes: [...this.nodes.values()].reverse(), defaults: FAKE_DEFAULT_LIMITS, protectedPaths: PROTECTED };
  }

  async actions(nodeId: string | null): Promise<NodeActionView[]> {
    this.deps.session.require();
    this.readFault();
    return this.log.filter((action) => nodeId === null || action.nodeId === nodeId).reverse();
  }

  revoke(id: string, input: RevokeNodeRequest): Promise<NodeView> {
    this.deps.session.require();
    return this.deps.receipts.run('node', input.requestId, `revoke ${id}`, () => {
      const node = this.nodes.get(id);
      if (node === undefined) {
        throw notFound();
      }
      const revoked = node.revokedAt === null ? this.put({ ...node, revokedAt: this.at() }) : node;
      return revoked;
    });
  }

  issueCode(): NodePairingCodeResponse {
    this.sequence += 1;
    const expiresAt = new Date(this.deps.now().getTime() + 10 * 60 * 1000).toISOString();
    return { code: `${CODE_PREFIX}-${String(this.sequence).padStart(4, '0')}`, expiresAt };
  }

  setLimits(id: string, input: SetNodeLimitsRequest): NodeView {
    const node = this.nodes.get(id);
    if (node === undefined) {
      throw notFound();
    }
    if (node.limitsVersion !== input.limitsVersion) {
      const message = '这台节点的上限刚刚在别处改过，你看到的是旧的，这次没有改。';
      throw new ConflictError(node, message, '先看现在的上限，再改。');
    }
    return this.put({
      ...node,
      limits: input.limits,
      limitsVersion: node.limitsVersion + 1,
      limitsAreDefault: false,
      limitsConfirmedAt: this.at(),
    });
  }

  addNode(name: string, capabilities: NodeView['capabilities'] = ['file_read', 'file_list']): NodeView {
    this.sequence += 1;
    const at = this.at();
    return this.put({
      id: `node_${this.sequence}`,
      name,
      platform: 'macos',
      appVersion: '0.1.0',
      protocolVersion: 1,
      capabilities,
      pairedAt: at,
      lastSeenAt: at,
      revokedAt: null,
      limits: FAKE_DEFAULT_LIMITS,
      limitsVersion: 0,
      limitsAreDefault: true,
      limitsConfirmedAt: null,
      usage: { read: 0, write: 0, delete: 0, command: 0, browser: 0, input: 0 },
      online: true,
      work: { state: 'idle', actionId: null, kind: null, step: null, since: null, reportedAt: at },
      version: 1,
    });
  }

  recordAction(nodeId: string, action: DeviceActionParams, refusal: { layer: string; reason: string } | null) {
    this.sequence += 1;
    const view: NodeActionView = {
      id: `na_${this.sequence}`,
      actionId: `act_${this.sequence}`,
      nodeId,
      kind: action.kind,
      kindLabel: action.kind,
      actionClass: 'read',
      target: 'path' in action && typeof action.path === 'string' ? action.path : action.kind,
      status: refusal === null ? 'executed' : 'refused',
      refusalLayer: refusal === null ? null : (refusal.layer as NodeActionView['refusalLayer']),
      reason: refusal?.reason ?? null,
      origin: 'brain',
      requestedAt: this.at(),
      executedAt: refusal === null ? this.at() : null,
      version: 1,
    };
    this.log.push(view);
    this.deps.bus.emit({ type: 'node_action.recorded', action: view });
    return view;
  }

  private put(node: NodeView): NodeView {
    const previous = this.nodes.get(node.id);
    const next = { ...node, version: (previous?.version ?? 0) + 1 };
    this.nodes.set(node.id, next);
    this.deps.bus.emit({ type: 'node.changed', node: next });
    return next;
  }

  private readFault(): void {
    const fault = this.deps.faults.take('device_read');
    if (fault !== undefined) {
      throw faultError('device_read', fault);
    }
  }

  private at(): string {
    return this.deps.now().toISOString();
  }
}
