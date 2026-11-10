import type { PlasticineApi } from '../../api/client.ts';
import { createRequestId } from '../../api/request-id.ts';
import type { MateDraft, MateGroupDraft, MateView, MateGroupView, LegacyChatConvertRequest,
  LegacyChatConvertResponse, MateHandoffResponse, UpdateMateRequest } from '../../api/shared.ts';
import type { ActionOps, ActionRequest } from '../../state/action-ops.ts';
import type { MatesStore } from './mates-store.ts';

type Result = MateView | MateGroupView | LegacyChatConvertResponse | MateHandoffResponse;
export const MATE_OP_PREFIXES = ['mates:', 'mate-groups:'] as const;

/** 创建和确认转换也沿用全站待核实记录；关掉表单或刷新后仍用原请求核实。 */
export class MateActions {
  private readonly api: PlasticineApi;
  private readonly ops: ActionOps;
  private readonly directory: MatesStore;
  private readonly running = new Set<string>();
  constructor(api: PlasticineApi, ops: ActionOps, directory: MatesStore) {
    this.api = api; this.ops = ops; this.directory = directory;
  }
  create(draft: MateDraft): Promise<Result | null> {
    return this.begin('mates:create', '创建队友', draft.name,
      (requestId) => ({ kind: 'mate_create', body: { requestId, ...draft } }));
  }
  update(mate: MateView, patch: Omit<UpdateMateRequest, 'requestId' | 'version'>): Promise<Result | null> {
    return this.begin(`mates:update:${mate.id}`, '更新队友', mate.name,
      (requestId) => ({ kind: 'mate_update', mateId: mate.id, body: { requestId, version: mate.version, ...patch } }));
  }
  createGroup(draft: MateGroupDraft): Promise<Result | null> {
    return this.begin('mate-groups:create', '创建群组', draft.name,
      (requestId) => ({ kind: 'mate_group_create', body: { requestId, ...draft } }));
  }
  updateGroup(group: MateGroupView, patch: MateGroupDraft): Promise<Result | null> {
    return this.begin(`mate-groups:update:${group.id}`, '更新群组', group.name,
      (requestId) => ({ kind: 'mate_group_update', groupId: group.id,
        body: { requestId, version: group.version, ...patch } }));
  }
  convert(input: Omit<LegacyChatConvertRequest, 'requestId'>, title: string): Promise<Result | null> {
    return this.begin(`mates:convert:${input.lineId}`, '整理原来的对话', title,
      (requestId) => ({ kind: 'mate_legacy_convert', body: { requestId, ...input } }));
  }
  retry(key: string): Promise<Result | null> {
    if (this.running.has(key)) return Promise.resolve(null);
    const request = this.ops.retry(key);
    return request === undefined ? Promise.resolve(null) : this.execute(key, request);
  }
  private begin(key: string, label: string, title: string, build: (id: string) => ActionRequest)
    : Promise<Result | null> {
    if (this.running.has(key)) return Promise.resolve(null);
    return this.execute(key, this.ops.begin(key, label, title, build, createRequestId));
  }
  private async execute(key: string, request: ActionRequest): Promise<Result | null> {
    this.running.add(key);
    try {
      const result = await this.transmit(request);
      this.ops.succeed(key);
      await this.directory.reload();
      return result;
    } catch (cause) {
      this.ops.fail(key, cause);
      return null;
    } finally { this.running.delete(key); }
  }
  private transmit(request: ActionRequest): Promise<Result> {
    switch (request.kind) {
      case 'mate_create': return this.api.mates.create(request.body);
      case 'mate_update': return this.api.mates.update(request.mateId, request.body);
      case 'mate_group_create': return this.api.mateGroups.create(request.body);
      case 'mate_group_update': return this.api.mateGroups.update(request.groupId, request.body);
      case 'mate_handoff': return this.api.mates.handoff(request.body);
      case 'mate_legacy_convert': return this.api.mates.convertLegacy(request.body);
      default: throw new Error('这不是队友操作，请回原来的页面核实。');
    }
  }
}
