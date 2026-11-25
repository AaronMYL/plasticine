import type { PlasticineApi } from '../../api/client.ts';
import { createRequestId } from '../../api/request-id.ts';
import { Value } from 'typebox/value';
import { DEVICE_CLASS_LABELS, SetNodeLimitsRequestSchema } from '../../api/shared.ts';
import type { NodeView } from '../../api/types.ts';
import type { ActionOps, ActionRequest } from '../../state/action-ops.ts';
import type { DeviceUi } from '../../state/device-ui.ts';
import type { InlineDrafts } from '../../state/inline-drafts.ts';
import { NODE_CODE_KEY, nodeLimitsKey, nodeRevokeKey } from '../../state/device-action-requests.ts';
import type { SignedOps } from '../../state/signed-ops.ts';
import { Store } from '../../state/store.ts';
import type { SignedSender } from '../signing/signed-sender.ts';
import type { DeviceStore } from './device-store.ts';
import { draftOf, limitsOf, parseDraft, type LimitsDraft } from './limits-draft.ts';

export interface DeviceWritesDeps {
  api: PlasticineApi;
  devices: DeviceStore;
  ops: ActionOps;
  signedOps: SignedOps;
  signer: SignedSender;
  drafts: InlineDrafts;
  ui: DeviceUi;
}

export class DeviceWrites {
  private readonly deps: DeviceWritesDeps;
  /** A problem with the form as written (it was not sent), by node id. */
  readonly problems = new Store<ReadonlyMap<string, string>>(new Map());

  constructor(deps: DeviceWritesDeps) {
    this.deps = deps;
  }

  async issueCode(): Promise<void> {
    this.dismissFailedSigned(NODE_CODE_KEY);
    const target = { kind: 'node_pairing_code' } as const;
    const result = await this.deps.signer.send(NODE_CODE_KEY, '领配对码', '新设备', target, (requestId) => ({
      requestId,
    }));
    if (result?.kind === 'node_code') {
      this.deps.ui.showCode(result.code);
    }
  }

  async revoke(node: NodeView): Promise<void> {
    const key = nodeRevokeKey(node.id);
    if (this.deps.ops.get(key)?.status === 'failed') {
      this.deps.ops.dismiss(key);
    }
    const request = this.deps.ops.begin(
      key,
      '撤销',
      node.name,
      (requestId): ActionRequest => ({ kind: 'node_revoke', nodeId: node.id, body: { requestId } }),
      createRequestId,
    );
    await this.perform(key, request);
  }

  limitsDraft(node: NodeView): LimitsDraft {
    return parseDraft(this.deps.drafts.get(nodeLimitsKey(node.id))) ?? draftOf(node.limits, node.limitsVersion);
  }

  startLimits(node: NodeView): void {
    this.editLimits(node, this.limitsDraft(node));
    this.deps.ui.setEditing(node.id, true);
  }

  async keepLimits(node: NodeView): Promise<void> {
    this.editLimits(node, { ...this.limitsDraft(node), limitsVersion: node.limitsVersion });
    await this.saveLimits(node);
  }

  editLimits(node: NodeView, draft: LimitsDraft): void {
    this.deps.drafts.set(nodeLimitsKey(node.id), JSON.stringify(draft));
    this.setProblem(node.id, null);
  }

  cancelLimits(node: NodeView): void {
    this.deps.drafts.clear(nodeLimitsKey(node.id));
    this.setProblem(node.id, null);
    this.deps.ui.setEditing(node.id, false);
  }

  async saveLimits(node: NodeView): Promise<void> {
    const key = nodeLimitsKey(node.id);
    const draft = this.limitsDraft(node);
    if (draft.limitsVersion !== node.limitsVersion) {
      return;
    }
    const checked = limitsOf(draft, DEVICE_CLASS_LABELS);
    if (!checked.ok) {
      this.setProblem(node.id, checked.problem);
      this.deps.drafts.set(key, JSON.stringify(draft));
      return;
    }
    this.setProblem(node.id, null);
    this.dismissFailedSigned(key);
    const target = { kind: 'node_limits', nodeId: node.id } as const;
    const sent = { limitsVersion: draft.limitsVersion, limits: checked.limits };
    const result = await this.deps.signer.send(key, '改上限', node.name, target, (requestId) => ({
      requestId,
      ...sent,
    }));
    if (result?.kind === 'node') {
      this.finishLimits(result.node, sent);
      return;
    }
    if (this.deps.signedOps.get(key)?.status === 'failed') {
      void this.deps.devices.reload();
    }
  }

  async retry(key: string): Promise<void> {
    const op = this.deps.signedOps.get(key);
    if (op !== undefined) {
      const result = await this.deps.signer.retry(key);
      if (result?.kind === 'node') {
        const sent: unknown = JSON.parse(op.bodyText);
        if (Value.Check(SetNodeLimitsRequestSchema, sent)) {
          this.finishLimits(result.node, sent);
        } else {
          this.deps.devices.applyNode(result.node);
          this.setProblem(result.node.id, '上次请求的格式无法核对，草稿还在，请对照现在的上限。');
        }
      } else if (result?.kind === 'node_code') {
        this.deps.ui.showCode(result.code);
      } else if (op.target.kind === 'node_limits' && this.deps.signedOps.get(key)?.status === 'failed') {
        void this.deps.devices.reload();
      }
      return;
    }
    const request = this.deps.ops.retry(key);
    if (request !== undefined) {
      await this.perform(key, request);
    }
  }

  dismiss(key: string): void {
    if (this.deps.signedOps.get(key) !== undefined) {
      this.deps.signer.dismiss(key);
    } else {
      this.deps.ops.dismiss(key);
    }
  }

  private finishLimits(node: NodeView, sent: { limitsVersion: number; limits: NodeView['limits'] }): void {
    this.deps.devices.applyNode(node);
    const key = nodeLimitsKey(node.id);
    const draft = parseDraft(this.deps.drafts.get(key));
    const checked = draft === null ? null : limitsOf(draft, DEVICE_CLASS_LABELS);
    if (draft?.limitsVersion === sent.limitsVersion && checked?.ok &&
      JSON.stringify(checked.limits) === JSON.stringify(sent.limits)) {
      this.deps.drafts.clear(key);
    }
    this.setProblem(node.id, null);
    if (this.deps.drafts.get(key) === '') {
      this.deps.ui.setEditing(node.id, false);
    }
  }

  private setProblem(nodeId: string, problem: string | null): void {
    this.problems.set((problems) => {
      if ((problems.get(nodeId) ?? null) === problem) {
        return problems;
      }
      const next = new Map(problems);
      if (problem === null) {
        next.delete(nodeId);
      } else {
        next.set(nodeId, problem);
      }
      return next;
    });
  }

  private dismissFailedSigned(key: string): void {
    if (this.deps.signedOps.get(key)?.status === 'failed') {
      this.deps.signer.dismiss(key);
    }
  }

  private async perform(key: string, request: ActionRequest): Promise<void> {
    try {
      if (request.kind === 'node_revoke') {
        this.deps.devices.applyNode(await this.deps.api.nodes.revoke(request.nodeId, request.body));
      }
      this.deps.ops.succeed(key);
    } catch (cause) {
      this.deps.ops.fail(key, cause);
    }
  }
}
