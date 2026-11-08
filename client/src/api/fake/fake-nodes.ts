// 假的执行节点（M5）：节点列表、最近的设备动作、撤销；本人确认的两项（领配对码、改上限）由 fake-signed.ts 核实会话后调
// 这里。和真服务端一样：撤销两次回答一样（按 requestId 幂等）、上限按 limitsVersion 防旧、被拒的动作带哪一层和一句原因。
// 测试经 control 往里放节点、记动作，模拟设备那一侧。

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

/** 和服务端 devices/defaults.ts 一样的默认上限（授权目录空着，删除逐次确认）。 */
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
// 码的样子照服务端（Crockford base32 两组四个）；假实现按序号拼，测试不用猜。
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

  /** 本人会话核实之后（fake-signed.ts）：领一个码。 */
  issueCode(): NodePairingCodeResponse {
    this.sequence += 1;
    const expiresAt = new Date(this.deps.now().getTime() + 10 * 60 * 1000).toISOString();
    return { code: `${CODE_PREFIX}-${String(this.sequence).padStart(4, '0')}`, expiresAt };
  }

  /** 本人会话核实之后：改上限，版本旧了是带现在那一台的 409。 */
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

  /** 测试：设备那一侧拿码配对了一台节点。 */
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
      version: 1,
    });
  }

  /** 测试：记下一个设备动作（做了、被拒），像服务端那样推一条事件。 */
  recordAction(nodeId: string, action: DeviceActionParams, refusal: { layer: string; reason: string } | null) {
    this.sequence += 1;
    const view: NodeActionView = {
      id: `na_${this.sequence}`,
      actionId: `act_${this.sequence}`,
      nodeId,
      kind: action.kind,
      kindLabel: action.kind,
      actionClass: 'read',
      target: 'path' in action ? action.path : action.kind,
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
