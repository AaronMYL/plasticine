import type { SignedApi } from '../client.ts';
import {
  AnswerAskResponseSchema,
  NodePairingCodeResponseSchema,
  NodeResponseSchema,
  NodeViewSchema,
  ToolGroupResponseSchema,
  ToolGroupViewSchema,
  UnlockNoteResponseSchema,
  MoneyDraftViewSchema,
  RestorePreviewSchema,
  UncertainItemSchema,
} from '../shared.ts';
import { SIGNED_METHOD, signedPath, type SignedResult, type SignedSend, type SignedTarget } from '../signed-targets.ts';
import { conflictWith } from './conflict.ts';
import type { RequestSpec, Transport } from './transport.ts';
import type { TSchema } from 'typebox';

const WHAT: Readonly<Record<SignedSend['target']['kind'], string>> = {
  device_action_answer: '逐次授权设备动作',
  backup_restore: '按对象恢复',
  money_draft_confirm: '确认记账',
  note_unlock: '解锁笔记',
  node_pairing_code: '领节点配对码',
  node_limits: '改节点上限',
  tool_group: '开关工具组',
  memory_uncertain: '记下这一条对不对',
};

export class HttpSigned implements SignedApi {
  private readonly transport: Transport;

  constructor(transport: Transport) {
    this.transport = transport;
  }

  async send(request: SignedSend): Promise<SignedResult> {
    const base = {
      method: SIGNED_METHOD,
      path: signedPath(request.target),
      rawBody: request.bodyText,
      what: WHAT[request.target.kind],
      lostAs: 'uncertain',
    } as const;
    return this.readResult(request.target, base);
  }

  async lookup(_requestId: string, _target: SignedTarget): Promise<SignedResult | null> {
    return null;
  }

  private async readResult(target: SignedTarget, base: Omit<RequestSpec<TSchema>, 'schema'>): Promise<SignedResult> {
    switch (target.kind) {
      case 'device_action_answer':
        return { kind: 'device_action_answer',
          response: await this.transport.request({ ...base, schema: AnswerAskResponseSchema }) };
      case 'backup_restore': {
        const preview = await this.transport.request({ ...base, schema: RestorePreviewSchema });
        return { kind: 'backup_restored', preview };
      }
      case 'money_draft_confirm': {
        const draft = await this.transport.request({ ...base, schema: MoneyDraftViewSchema });
        return { kind: 'money_draft', draft };
      }
      case 'note_unlock': {
        await this.transport.request({ ...base, schema: UnlockNoteResponseSchema });
        return { kind: 'note_unlocked' };
      }
      case 'node_pairing_code': {
        const code = await this.transport.request({ ...base, schema: NodePairingCodeResponseSchema });
        return { kind: 'node_code', code };
      }
      case 'node_limits': {
        const response = await this.transport.request({
          ...base,
          schema: NodeResponseSchema,
          refine: conflictWith(NodeViewSchema),
        });
        return { kind: 'node', node: response.node };
      }
      case 'tool_group': {
        const response = await this.transport.request({
          ...base,
          schema: ToolGroupResponseSchema,
          refine: conflictWith(ToolGroupViewSchema),
        });
        return { kind: 'tool_group', group: response.group };
      }
      case 'memory_uncertain': {
        const item = await this.transport.request({ ...base, schema: UncertainItemSchema });
        return { kind: 'memory_uncertain', item };
      }
    }
  }
}
