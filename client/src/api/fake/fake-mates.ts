import { Value } from 'typebox/value';
import { ApiError } from '../errors.ts';
import type { MatesApi, MateGroupsApi } from '../mates-client.ts';
import { MateDraftSchema, MateGroupDraftSchema } from '../shared.ts';
import type { MateDraft, MateView, MateGroupView, MateGroupDraft, CreateMateRequest, UpdateMateRequest,
  MateHandoffRequest, LegacyChatConvertRequest, LegacyChatProposal } from '../shared.ts';
import { MAIN_LINE_ID, type FakeLines } from './fake-lines.ts';
import type { FakeSession } from './fake-session.ts';
import type { FakeReceipts } from './receipts.ts';

interface Deps { session: FakeSession; lines: FakeLines; receipts: FakeReceipts; now: () => Date }
const invalid = (message: string) => new ApiError({ kind: 'invalid', status: 400, code: 'invalid_request', message });
const missing = () => new ApiError({ kind: 'not_found', status: 404, code: 'not_found', message: '没有这位队友。' });
const conflict = () => new ApiError({ kind: 'conflict', status: 409, code: 'version_conflict',
  message: '资料已经改变，请刷新后再修改。' });

export class FakeMates implements MatesApi {
  private readonly rows = new Map<string, MateView>();
  private readonly groupRows = new Map<string, MateGroupView>();
  private readonly deps: Deps;
  private serial = 0;
  constructor(deps: Deps) { this.deps = deps; }

  async list() {
    this.deps.session.require();
    return { mates: structuredClone([...this.rows.values()]), groups: structuredClone([...this.groupRows.values()]),
      legacyChats: this.deps.lines.allLines().filter((line) => line.kind === 'side' && line.mateId == null
        && line.mateGroupId == null && line.archivedAt == null)
        .map((line) => ({ lineId: line.id, title: line.title, updatedAt: line.updatedAt })) };
  }
  async get(id: string): Promise<MateView> {
    this.deps.session.require();
    const row = this.rows.get(id);
    if (row === undefined) throw missing();
    return structuredClone(row);
  }
  private add(draft: MateDraft, previousLineId?: string): MateView {
    if (!Value.Check(MateDraftSchema, draft)) throw invalid('请填写名字、头像、职责和 Soul。');
    const id = `mate-${++this.serial}`;
    const lineId = previousLineId ?? `line-${id}`;
    const at = this.deps.now().toISOString();
    const mate = { ...draft, id, lineId, version: 1, createdAt: at, updatedAt: at, disabledAt: null };
    this.rows.set(id, mate);
    if (previousLineId === undefined) this.deps.lines.put(this.deps.lines.blank(lineId, 'side', draft.name, { mateId: id }));
    else this.deps.lines.change(lineId, { mateId: id, title: draft.name });
    return structuredClone(mate);
  }
  async create({ requestId, ...draft }: CreateMateRequest): Promise<MateView> {
    this.deps.session.require();
    return this.deps.receipts.run('create', requestId, 'POST /v2/mates', () => this.add(draft));
  }
  async update(id: string, input: UpdateMateRequest): Promise<MateView> {
    this.deps.session.require();
    return this.deps.receipts.run('save', input.requestId, `PATCH /v2/mates/${id}`, () => {
      const current = this.rows.get(id);
      if (current === undefined) throw missing();
      if (current.version !== input.version) throw conflict();
      const draft: MateDraft = { name: input.name ?? current.name, avatar: input.avatar ?? current.avatar,
        hue: input.hue ?? current.hue, role: input.role ?? current.role, soul: input.soul ?? current.soul,
        purpose: input.purpose === undefined ? current.purpose : input.purpose };
      if (!Value.Check(MateDraftSchema, draft)) throw invalid('请核对名字、职责和 Soul。');
      const next = { ...current, ...draft, version: current.version + 1, updatedAt: this.deps.now().toISOString(),
        disabledAt: input.disabled === undefined ? current.disabledAt
          : input.disabled ? this.deps.now().toISOString() : null };
      this.rows.set(id, next);
      this.deps.lines.change(current.lineId, { title: next.name });
      return structuredClone(next);
    });
  }
  private groupDraft(input: MateGroupDraft): void {
    if (!Value.Check(MateGroupDraftSchema, input)) throw invalid('群组需要名字和 2–6 位不同的队友。');
    for (const id of input.mateIds) if (this.rows.get(id)?.disabledAt !== null) {
      throw invalid('请从可用的队友中选择群组成员。');
    }
  }
  readonly groups: MateGroupsApi = {
    create: async ({ requestId, ...draft }) => {
      this.deps.session.require();
      return this.deps.receipts.run('create', requestId, 'POST /v2/mate-groups', () => {
        this.groupDraft(draft);
        const id = `mate-group-${++this.serial}`;
        const at = this.deps.now().toISOString();
        const group = { ...draft, id, lineId: `line-${id}`, version: 1, createdAt: at, updatedAt: at };
        this.groupRows.set(id, group);
        this.deps.lines.put(this.deps.lines.blank(group.lineId, 'side', group.name, { mateGroupId: id }));
        return structuredClone(group);
      });
    },
    update: async (id, input) => {
      this.deps.session.require();
      return this.deps.receipts.run('save', input.requestId, `PATCH /v2/mate-groups/${id}`, () => {
        const current = this.groupRows.get(id);
        if (current === undefined) throw missing();
        if (current.version !== input.version) throw conflict();
        const draft = { name: input.name ?? current.name, mateIds: input.mateIds ?? current.mateIds };
        this.groupDraft(draft);
        const next = { ...current, ...draft, version: current.version + 1, updatedAt: this.deps.now().toISOString() };
        this.groupRows.set(id, next);
        this.deps.lines.change(next.lineId, { title: next.name });
        return structuredClone(next);
      });
    },
  };
  async handoff(input: MateHandoffRequest) {
    this.deps.session.require();
    return this.deps.receipts.run('create', input.requestId, 'POST /v2/mates/handoff', () => {
      const mate = this.rows.get(input.mateId);
      if (mate === undefined || mate.disabledAt !== null) throw missing();
      const line = this.deps.lines.blank(`handoff-${++this.serial}`, 'background', input.goal, {
        mateId: mate.id, mateGroupId: input.groupId ?? null, status: 'queued',
        parentLineId: input.groupId == null ? input.sourceLineId : this.groupRows.get(input.groupId)?.lineId ?? null });
      this.deps.lines.put(line);
      return { line };
    });
  }
  async prepareLegacy(lineId: string): Promise<LegacyChatProposal> {
    this.deps.session.require();
    const legacy = (await this.list()).legacyChats.find((row) => row.lineId === lineId);
    if (legacy === undefined) throw missing();
    return { lineId: legacy.lineId, title: legacy.title, recommendation: 'mate', reason: '这段对话可以由一位专门的队友接着处理。',
      draft: { name: legacy.title.slice(0, 38) + '队友', avatar: '友', hue: 'sky',
        role: '接着处理这段对话的工作', soul: '', purpose: null } };
  }
  async convertLegacy(input: LegacyChatConvertRequest) {
    this.deps.session.require();
    return this.deps.receipts.run('save', input.requestId, 'POST /v2/mates/legacy/convert', () => {
      const line = this.deps.lines.find(input.lineId);
      if (line === undefined || line.kind !== 'side' || line.mateId != null || line.mateGroupId != null) throw missing();
      if (input.action === 'mate') {
        if (input.draft === undefined) throw invalid('请先确认队友的名字和职责。');
        return { lineId: line.id, mate: this.add(input.draft, line.id) };
      }
      for (const message of this.deps.lines.messagesOf(line.id)) this.deps.lines.record(MAIN_LINE_ID, message);
      this.deps.lines.change(line.id, { archivedAt: this.deps.now().toISOString() });
      return { lineId: MAIN_LINE_ID, mate: null };
    });
  }
}
