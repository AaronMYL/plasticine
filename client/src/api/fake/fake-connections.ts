// 假的连接和推送记录（11-16）：连接在内存里，地址里带 fail 的测不通（给截图看「没连上」那一行）；推送记录先放三条
// 虚构的，撤回只记时间。

import { ApiError } from '../errors.ts';
import type { ConnectionsApi, PushesApi } from '../connections-client.ts';
import type {
  ConnectionCreateRequest,
  ConnectionTool,
  ConnectionUpdateRequest,
  ConnectionView,
  PushRecord,
} from '../shared.ts';
import type { FakeEventBus } from './event-bus.ts';
import type { FakeSession } from './fake-session.ts';

const SAMPLE_TOOLS: ConnectionTool[] = [
  { name: 'search_pages', description: '按关键词找页面', readOnly: true },
  { name: 'read_page', description: '读一页的内容', readOnly: true },
  { name: 'create_page', description: '新建一页', readOnly: false },
  { name: 'update_page', description: '改一页', readOnly: false },
];

function notFound(): ApiError {
  return new ApiError({ kind: 'not_found', code: 'not_found', message: '找不到了。', status: 404 });
}

export class FakeConnections implements ConnectionsApi {
  private readonly items = new Map<string, ConnectionView>();
  private readonly session: FakeSession;
  private readonly bus: FakeEventBus;
  private readonly now: () => Date;
  private sequence = 0;

  constructor(session: FakeSession, bus: FakeEventBus, now: () => Date) {
    this.session = session;
    this.bus = bus;
    this.now = now;
  }

  /** 截图用：先放几个。 */
  seed(input: ConnectionCreateRequest, fail = false): void {
    const view = this.tested(this.fresh(input), fail);
    this.items.set(view.id, view);
  }

  async list(): Promise<ConnectionView[]> {
    this.session.require();
    return [...this.items.values()];
  }

  async create(input: ConnectionCreateRequest): Promise<ConnectionView> {
    this.session.requireUser();
    const view = this.tested(this.fresh(input), input.url.includes('fail'));
    this.items.set(view.id, view);
    this.bus.emit({ type: 'connections.changed' });
    return view;
  }

  async update(id: string, input: ConnectionUpdateRequest): Promise<ConnectionView> {
    this.session.requireUser();
    const current = this.items.get(id);
    if (current === undefined) throw notFound();
    let next: ConnectionView = { ...current, ...(input.name === undefined ? {} : { name: input.name }),
      ...(input.url === undefined ? {} : { url: input.url }),
      ...(input.token === undefined ? {} : { hasToken: input.token !== null }),
      ...(input.enabled === undefined ? {} : { enabled: input.enabled }) };
    if (input.url !== undefined || input.token !== undefined) next = this.tested(next, next.url.includes('fail'));
    this.items.set(id, next);
    this.bus.emit({ type: 'connections.changed' });
    return next;
  }

  async test(id: string): Promise<ConnectionView> {
    this.session.requireUser();
    const current = this.items.get(id);
    if (current === undefined) throw notFound();
    const next = this.tested(current, current.url.includes('fail'));
    this.items.set(id, next);
    return next;
  }

  async remove(id: string): Promise<void> {
    this.session.requireUser();
    this.items.delete(id);
    this.bus.emit({ type: 'connections.changed' });
  }

  private fresh(input: ConnectionCreateRequest): ConnectionView {
    this.sequence += 1;
    return { id: `conn_${this.sequence}`, name: input.name, url: input.url, hasToken: input.token !== undefined,
      enabled: true, tools: [], status: 'untested', error: null, checkedAt: null };
  }

  private tested(view: ConnectionView, fail: boolean): ConnectionView {
    const checkedAt = this.now().toISOString();
    return fail ? { ...view, status: 'error', error: '令牌过期了', checkedAt }
      : { ...view, status: 'ok', error: null, tools: SAMPLE_TOOLS, checkedAt };
  }
}

export class FakePushes implements PushesApi {
  private readonly items: PushRecord[] = [];
  private readonly session: FakeSession;
  private readonly bus: FakeEventBus;
  private readonly now: () => Date;

  constructor(session: FakeSession, bus: FakeEventBus, now: () => Date) {
    this.session = session;
    this.bus = bus;
    this.now = now;
  }

  /** 截图和测试用：放一条（minutesAgo 分钟前推的）。 */
  seed(record: Omit<PushRecord, 'createdAt' | 'withdrawnAt'>, minutesAgo: number, withdrawn = false): void {
    const at = new Date(this.now().getTime() - minutesAgo * 60_000).toISOString();
    this.items.push({ ...record, createdAt: at, withdrawnAt: withdrawn ? at : null });
    this.items.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async list(): Promise<PushRecord[]> {
    this.session.require();
    return [...this.items];
  }

  async withdraw(id: string): Promise<PushRecord> {
    this.session.requireUser();
    const index = this.items.findIndex((item) => item.id === id);
    const current = this.items[index];
    if (current === undefined) throw notFound();
    const next = { ...current, withdrawnAt: current.withdrawnAt ?? this.now().toISOString() };
    this.items[index] = next;
    this.bus.emit({ type: 'pushes.changed' });
    return next;
  }
}
