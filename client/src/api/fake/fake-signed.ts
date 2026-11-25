import { Value } from 'typebox/value';
import type { SignedApi } from '../client.ts';
import { ApiError } from '../errors.ts';
import {
  AnswerAskRequestSchema,
  IssueNodePairingCodeRequestSchema,
  SetNodeLimitsRequestSchema,
  SetToolGroupRequestSchema,
  UnlockNoteRequestSchema,
  ConfirmMoneyDraftRequestSchema,
  RestoreBackupRequestSchema,
  AnswerUncertainRequestSchema,
} from '../shared.ts';
import type { FakeToolGroups } from './fake-inbox.ts';
import { signedPath, type SignedResult, type SignedSend, type SignedTarget } from '../signed-targets.ts';
import type { FakeNodes } from './fake-nodes.ts';
import type { FakeSession } from './fake-session.ts';
import type { FakeNotes } from './fake-notes.ts';
import type { FakeMoneyDrafts } from './fake-money-drafts.ts';
import type { FakeBackups } from './fake-backups.ts';
import type { FakeReceipts } from './receipts.ts';
import type { FakeAsks } from './fake-asks.ts';
import type { FakeMemoryTopics } from './fake-memory-topics.ts';
import { faultError, type FaultPlan } from './faults.ts';

export interface FakeSignedDeps {
  asks?: FakeAsks;
  session: FakeSession;
  receipts: FakeReceipts;
  /** M5: set once the device fake exists (fake/index.ts). */
  nodes?: FakeNodes;
  faults?: FaultPlan;
  notes?: FakeNotes;
  moneyDrafts?: FakeMoneyDrafts;
  backups?: FakeBackups;
  memoryTopics?: FakeMemoryTopics;
}

function invalid(what: string): ApiError {
  return new ApiError({ kind: 'invalid', code: 'invalid_request', message: `${what}：请求体不对。`, status: 400 });
}

function missing(what: string): never {
  throw new Error(`假接口没有接上${what}`);
}

export class FakeSigned implements SignedApi {
  readonly deps: FakeSignedDeps;
  private toolGroups: FakeToolGroups | null = null;

  constructor(deps: FakeSignedDeps) {
    this.deps = deps;
  }

  private requireSession(target: SignedTarget): void {
    if (target.kind === 'note_unlock') this.deps.session.require();
    else this.deps.session.requireUser();
  }

  async lookup(requestId: string, target: SignedTarget): Promise<SignedResult | null> {
    this.requireSession(target);
    return this.deps.receipts.lookup(requestId, (scope) => scope.startsWith(`POST ${signedPath(target)} `));
  }

  async send(request: SignedSend): Promise<SignedResult> {
    this.requireSession(request.target);
    const body: unknown = JSON.parse(request.bodyText);
    const scope = `POST ${signedPath(request.target)} ${request.bodyText}`;
    const { target } = request;
    const { receipts } = this.deps;
    switch (target.kind) {
      case 'device_action_answer': {
        if (!Value.Check(AnswerAskRequestSchema, body)) { throw invalid('逐次授权设备动作'); }
        const asks = this.deps.asks ?? missing('要你授权卡');
        return receipts.run<SignedResult>('signed', body.requestId, scope, () => ({
          kind: 'device_action_answer', response: asks.answerSigned(target.askId, body),
        }));
      }
      case 'backup_restore': {
        if (!Value.Check(RestoreBackupRequestSchema, body)) { throw invalid('恢复对象'); }
        const backups = this.deps.backups;
        if (backups === undefined) { return missing('本机备份'); }
        const preview = await receipts.run('backup', body.requestId, scope,
          () => backups.restore(target.backupId, body));
        return { kind: 'backup_restored', preview };
      }
      case 'money_draft_confirm': {
        if (!Value.Check(ConfirmMoneyDraftRequestSchema, body)) { throw invalid('确认记账'); }
        const drafts = this.deps.moneyDrafts ?? missing('记账草案');
        return receipts.run<SignedResult>('signed', body.requestId, scope, () => ({ kind: 'money_draft',
          draft: drafts.confirm(target.draftId, body) }));
      }
      case 'note_unlock': {
        if (!Value.Check(UnlockNoteRequestSchema, body)) {
          throw invalid('解锁笔记');
        }
        const notes = this.deps.notes ?? missing('笔记');
        notes.unlock(target.noteId);
        return { kind: 'note_unlocked' };
      }
      case 'node_pairing_code': {
        if (!Value.Check(IssueNodePairingCodeRequestSchema, body)) {
          throw invalid('领节点配对码');
        }
        const nodes = this.deps.nodes ?? missing('节点');
        const fault = this.deps.faults?.take('signed');
        if (fault !== undefined && (fault.kind === 'failed' || !fault.landed)) {
          throw faultError('signed', fault);
        }
        const code = nodes.issueCode();
        if (fault !== undefined) {
          throw faultError('signed', fault);
        }
        return { kind: 'node_code', code };
      }
      case 'node_limits': {
        if (!Value.Check(SetNodeLimitsRequestSchema, body)) {
          throw invalid('改节点上限');
        }
        const nodes = this.deps.nodes ?? missing('节点');
        return receipts.run<SignedResult>('signed', body.requestId, scope, () => ({
          kind: 'node',
          node: nodes.setLimits(target.nodeId, body),
        }));
      }
      case 'tool_group': {
        const groups = this.toolGroups;
        if (!Value.Check(SetToolGroupRequestSchema, body) || groups === null) {
          throw invalid('开关工具组');
        }
        return this.deps.receipts.run<SignedResult>('signed', body.requestId, scope, () => ({
          kind: 'tool_group',
          group: groups.confirm(target.groupId, body),
        }));
      }
      case 'memory_uncertain': {
        if (!Value.Check(AnswerUncertainRequestSchema, body)) {
          throw invalid('拿不准的这一条');
        }
        const topics = this.deps.memoryTopics ?? missing('记忆主题');
        return receipts.run<SignedResult>('signed', body.requestId, scope, () => ({
          kind: 'memory_uncertain',
          item: topics.answerSigned(target.uncertainId, body),
        }));
      }
    }
  }

  setToolGroups(groups: FakeToolGroups): void {
    this.toolGroups = groups;
  }
}
