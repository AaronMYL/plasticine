// 本人确认的写操作：原样请求体随已配对会话发送，不再读取或发送浏览器签名。
// 节点上限、约定过时了服务端回 409 和现在那一份，换成 ConflictError。

import type { SignedApi } from '../client.ts';
import {
  AgreementResponseSchema,
  AnswerAskResponseSchema,
  AgreementViewSchema,
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
import type { Transport } from './transport.ts';
import type { RequestSpec } from './transport.ts';
import type { TSchema } from 'typebox';

const WHAT: Readonly<Record<SignedSend['target']['kind'], string>> = {
  device_action_answer: '逐次授权设备动作',
  backup_restore: '按对象恢复',
  money_draft_confirm: '确认记账',
  note_unlock: '解锁笔记',
  agreement_confirm: '确认约定',
  agreement_edit: '修改生效约定',
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

  /**
   * 按 requestId 核实一次确认操作：服务端 2026-11-05 清理时删了统一的核实接口（/v2/signed-requests），查不到就是
   * 「不知道」（null），调用方照原样保留「结果待核实」，由用户刷新后看实际状态。
   */
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
      case 'agreement_edit':
      case 'agreement_confirm': {
        const response = await this.transport.request({
          ...base,
          schema: AgreementResponseSchema,
          refine: conflictWith(AgreementViewSchema),
        });
        return { kind: 'agreement', agreement: response.agreement };
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
