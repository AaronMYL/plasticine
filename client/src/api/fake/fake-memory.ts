// 假的旧记忆条目（2026-11-03 起只读，同真服务端 agent/src/app/memory.ts）：一条的详情（引用里的原话出处）和来源；
// 别处改了（脑、另一台设备）照旧推 memory.changed。改、删、新建、三栏的接口都去掉了。

import type { MemoryApi } from '../client.ts';
import { ApiError } from '../errors.ts';
import type { CognitionSourceDetail } from '../shared.ts';
import type { ChangeRecordView, MemoryEntryDetail, MemoryEntryView } from '../types.ts';
import { memoryEntryView, type MemorySeed } from './cognition-views.ts';
import type { FakeEventBus } from './event-bus.ts';
import type { FakeAgreements } from './fake-agreements.ts';
import type { FakeSession } from './fake-session.ts';
import { changeRecord } from './history.ts';
import type { FakeReceipts } from './receipts.ts';

export interface FakeMemoryDeps {
  session: FakeSession;
  bus: FakeEventBus;
  receipts: FakeReceipts;
  agreements: FakeAgreements;
  now: () => Date;
}

function notFound(): ApiError {
  return new ApiError({ kind: 'not_found', code: 'not_found', message: '没有找到这条记忆。', status: 404 });
}

export class FakeMemory implements MemoryApi {
  all(): MemoryEntryView[] { return structuredClone([...this.rows.values()]); }
  readonly sourceDetails = new Map<string, CognitionSourceDetail>();
  private readonly rows = new Map<string, MemoryEntryView>();
  private readonly history = new Map<string, ChangeRecordView[]>();
  private readonly deps: FakeMemoryDeps;

  constructor(deps: FakeMemoryDeps) {
    this.deps = deps;
  }

  async source(id: string): Promise<CognitionSourceDetail> {
    this.deps.session.require();
    const detail = this.sourceDetails.get(id);
    if (detail !== undefined) { return detail; }
    const entry = [...this.rows.values()].find((row) => row.source?.id === id);
    if (entry?.source == null) { throw notFound(); }
    return { source: entry.source, evidence: null, history: [] };
  }

  async entry(id: string): Promise<MemoryEntryDetail> {
    this.deps.session.require();
    const entry = this.rows.get(id);
    if (entry === undefined) {
      throw notFound();
    }
    return {
      entry,
      history: this.history.get(id) ?? [],
    };
  }

  /** 开发 / 测试：放进一条（不推事件，当作页面打开前就有的）。 */
  seed(seed: MemorySeed): MemoryEntryView {
    const row = memoryEntryView(seed);
    this.rows.set(row.id, row);
    const actor = row.migrated ? 'migration' : 'brain';
    const first = changeRecord({ version: 1, actor, reason: row.provenance, fields: [], at: row.createdAt });
    this.history.set(row.id, [first]);
    return row;
  }

  find(id: string): MemoryEntryView | undefined {
    return this.rows.get(id);
  }

  /** 另一台设备（或脑）改了它：版本加一，推 memory.changed。 */
  changeElsewhere(id: string, patch: Partial<Omit<MemoryEntryView, 'id' | 'version'>>): MemoryEntryView {
    const current = this.rows.get(id);
    if (current === undefined) {
      throw notFound();
    }
    return this.commit({ ...current, ...patch }, '在另一台设备上改的', Object.keys(patch), 'user');
  }


  private commit(
    next: MemoryEntryView,
    reason: string,
    fields: string[],
    actor: ChangeRecordView['actor'] = 'user',
  ): MemoryEntryView {
    const at = this.deps.now().toISOString();
    const saved: MemoryEntryView = {
      ...next,
      version: next.version + 1,
      updatedAt: at,
      awaitingConfirmation: actor === 'user' ? false : next.awaitingConfirmation,
    };
    this.rows.set(saved.id, saved);
    const record = changeRecord({ version: saved.version, actor, reason, fields, at });
    this.history.set(saved.id, [...(this.history.get(saved.id) ?? []), record]);
    this.deps.bus.emit({ type: 'memory.changed', entry: saved });
    return saved;
  }
}
