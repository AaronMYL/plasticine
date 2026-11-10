// 假空间与订阅（第 6、7 条）：照真服务端的规矩——改空间存成新的一版、带 version、旧了 409；撤销恢复上一版；
// 「以后都这样」把那一版上的规则写进订阅设置；没出过样刊不能开定时；首页回顾读最近一期日报和昨晚的整理。

import { ApiError } from '../errors.ts';
import type { SpaceListFilter, SpacesApi, SubscriptionsApi } from '../spaces-client.ts';
import type {
  AdoptRuleRequest,
  DeleteSpaceRequest,
  IssueBrief,
  MemoryDreamView,
  RestoreSpaceRequest,
  ReviewSummary,
  RunSubscriptionRequest,
  RunSubscriptionResponse,
  SaveSpaceRequest,
  SpaceListResponse,
  SpaceView,
  Subscription,
  SubscriptionListResponse,
  SubscriptionView,
  UndoSpaceRequest,
  UpdateSubscriptionRequest,
} from '../shared.ts';
import type { FakeEventBus } from './event-bus.ts';
import type { FakeReceipts } from './receipts.ts';
import type { FakeSession } from './fake-session.ts';
import { REVIEW_ID, SEED_ASSETS, spaceSeeds, subscriptionSeeds, type SeedSpace } from './spaces-seed.ts';

export interface FakeSpacesDeps {
  session: FakeSession;
  bus?: FakeEventBus;
  receipts: FakeReceipts;
  now: () => Date;
  /** 首页回顾里「昨晚整理了几条」读记忆页那一次整理。 */
  dream: () => MemoryDreamView | null;
}

function notFound(what: string): ApiError {
  return new ApiError({ kind: 'not_found', code: 'not_found', status: 404, message: `没有${what}。` });
}

function conflict(message: string): ApiError {
  return new ApiError({ kind: 'conflict', code: 'version_conflict', status: 409, message });
}

const ONE_MINUTE_MS = 60_000;

/** 网页版的那一句：报告取第一个 h1，来信就是题目；旧版式取结论大标题。 */
function headlineOf(row: SeedSpace): string {
  if (row.html === null) {
    return row.doc.headline ?? row.title;
  }
  if (row.genre === 'letter') {
    return row.title;
  }
  const found = /<h1[^>]*>([\s\S]*?)<\/h1>/.exec(row.html)?.[1];
  return found === undefined ? row.title : found.replace(/<[^>]+>/g, '');
}

export class FakeSpaces {
  private readonly deps: FakeSpacesDeps;
  private spaceRows: SeedSpace[] = [];
  private subs: Subscription[];

  constructor(deps: FakeSpacesDeps) {
    this.deps = deps;
    // 个人回顾一直在（真服务端启动时建上）。
    this.subs = subscriptionSeeds(deps.now()).filter((sub) => sub.id === REVIEW_ID);
  }

  /** 假查找用：每个空间的标题和正文（JSON 原样当正文查）。 */
  searchable(): { id: string; updatedAt: string; title: string; text: string }[] {
    return this.live().map((row) => ({ id: row.id, updatedAt: row.updatedAt, title: row.title,
      text: row.html === null ? JSON.stringify(row.doc) : row.html.replace(/<[^>]+>/g, ' ') }));
  }

  seed(): void {
    const now = this.deps.now();
    this.spaceRows = spaceSeeds(now);
    this.subs = subscriptionSeeds(now);
  }

  findBySourceUrl(url: string, category: SeedSpace['category']): Pick<SeedSpace, 'id' | 'deletedAt'> | undefined {
    return this.spaceRows.find((row) => row.sourceUrl === url && row.category === category);
  }

  ensureGenerated(input: Pick<SeedSpace, 'id' | 'title' | 'html' | 'category' | 'sourceUrl' | 'bookId'>,
    rewrite = false): string {
    const current = this.spaceRows.find((row) => row.id === input.id);
    if (current !== undefined) {
      if (rewrite && current.deletedAt == null) {
        Object.assign(current, input, { updatedAt: this.deps.now().toISOString() });
        current.revisions.push({ doc: current.doc, genre: current.genre, html: current.html,
          change: null, rule: null });
        this.deps.bus?.emit({ type: 'space.changed', spaceId: current.id });
      }
      return current.id;
    }
    const doc = { stats: [], blocks: [], sources: [] };
    this.spaceRows.push({ ...input, kind: 'space', genre: 'report', author: 'ai', subscriptionId: null,
      issueNumber: null, edition: null, doc, createdAt: this.deps.now().toISOString(),
      updatedAt: this.deps.now().toISOString(), revisions: [{ doc, genre: 'report', html: input.html,
        change: null, rule: null }] });
    return input.id;
  }

  /** 没删的。 */
  private live(): SeedSpace[] {
    return this.spaceRows.filter((row) => (row.deletedAt ?? null) === null);
  }

  /** 「最近删除」里的空间（假 GET /v2/library/trash 用）。 */
  deletedRows(): { id: string; title: string; deletedAt: string }[] {
    return this.spaceRows.flatMap((row) => (row.deletedAt == null ? []
      : [{ id: row.id, title: row.title, deletedAt: row.deletedAt }]));
  }

  purgeDeleted(id: string): void {
    this.deps.session.require();
    if (!this.deletedRows().some((row) => row.id === id)) throw notFound('最近删除里的这个空间');
    this.spaceRows = this.spaceRows.filter((row) => row.id !== id);
  }

  private space(id: string): SeedSpace {
    const found = this.live().find((row) => row.id === id);
    if (found === undefined) {
      throw notFound('这个空间');
    }
    return found;
  }

  private subscription(id: string): Subscription {
    const found = this.subs.find((row) => row.id === id);
    if (found === undefined) {
      throw notFound('这个订阅');
    }
    return found;
  }

  private view(row: SeedSpace): SpaceView {
    const sub = row.subscriptionId === null ? undefined : this.subs.find((item) => item.id === row.subscriptionId);
    const last = row.revisions.at(-1);
    const version = row.revisions.length;
    const lastChange = last === undefined || last.change === null || version === 1 ? null
      : { version, change: last.change, rule: last.rule,
        adopted: last.rule !== null && (sub?.settings.rules.some((rule) => rule.text === last.rule) ?? false) };
    return { id: row.id, title: row.title, category: row.category ?? row.genre ?? 'report',
      sourceUrl: row.sourceUrl ?? null, bookId: row.bookId ?? null, folder: row.folder ?? null,
      version, kind: row.kind, genre: row.genre, author: row.author,
      createdAt: row.createdAt, updatedAt: row.updatedAt, html: row.html,
      doc: structuredClone(row.doc), subscription: sub === undefined ? null
        : { id: sub.id, title: sub.title, version: sub.version },
      issueNumber: row.issueNumber, edition: row.edition, lastChange };
  }

  private brief(row: SeedSpace): IssueBrief | null {
    if (row.subscriptionId === null || row.issueNumber === null) {
      return null;
    }
    return { spaceId: row.id, subscriptionId: row.subscriptionId, issueNumber: row.issueNumber, edition: row.edition,
      genre: row.genre, title: row.title, headline: headlineOf(row), stats: row.html === null ? row.doc.stats : [],
      createdAt: row.createdAt };
  }

  private issues(subscriptionId: string): IssueBrief[] {
    return this.live().filter((row) => row.subscriptionId === subscriptionId)
      .sort((a, b) => (b.issueNumber ?? 0) - (a.issueNumber ?? 0))
      .map((row) => this.brief(row)).filter((brief): brief is IssueBrief => brief !== null);
  }

  private subView(sub: Subscription): SubscriptionView {
    const next = sub.status === 'active' ? new Date(this.deps.now().getTime() + 36 * 3_600_000).toISOString() : null;
    return { id: sub.id, title: sub.title, kind: sub.kind, status: sub.status, version: sub.version,
      settings: structuredClone(sub.settings), timeZone: sub.timeZone, lastRunAt: sub.lastRunAt, nextRunAt: next,
      issues: this.issues(sub.id) };
  }

  private replaceSub(next: Subscription): Subscription {
    this.subs = this.subs.map((row) => (row.id === next.id ? next : row));
    return next;
  }

  readonly spaces: SpacesApi = {
    versions: async (id, version) => {
      this.deps.session.require();
      const row = this.space(id);
      const revisions = row.revisions.map((revision, index) => ({ ...revision, spaceId: id, version: index + 1,
        title: row.title, author: row.author, savedAt: row.updatedAt, restoredFrom: null }));
      const selected = version === undefined ? null : revisions.find((revision) => revision.version === version);
      if (selected === undefined) throw notFound('这一版空间');
      return { selected, versions: revisions.toReversed().map(({ doc: _doc, html: _html, ...info }) => info) };
    },
    list: async (_signal?: AbortSignal, filter: SpaceListFilter = {}): Promise<SpaceListResponse> => {
      this.deps.session.require();
      const rows = this.live().filter((row) => filter.standalone !== true || row.subscriptionId === null);
      return { spaces: rows.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).map((row) => ({
        id: row.id, title: row.title, category: row.category ?? row.genre ?? 'report',
        sourceUrl: row.sourceUrl ?? null, bookId: row.bookId ?? null, folder: row.folder ?? null,
        kind: row.kind, genre: row.genre, author: row.author,
        subscriptionId: row.subscriptionId, issueNumber: row.issueNumber, edition: row.edition,
        version: row.revisions.length, createdAt: row.createdAt, updatedAt: row.updatedAt })) };
    },
    get: async (id: string): Promise<SpaceView> => {
      this.deps.session.require();
      return this.view(this.space(id));
    },
    save: (id: string, input: SaveSpaceRequest): Promise<SpaceView> => {
      this.deps.session.require();
      return this.deps.receipts.run('save', input.requestId, 'PUT /v2/spaces', () => {
        const row = this.space(id);
        if (row.revisions.length !== input.version) {
          throw conflict('这个空间在别处改过了，这次没有存。');
        }
        if (input.html !== undefined && row.html === null) {
          throw new ApiError({ kind: 'invalid', code: 'invalid_input', status: 400,
            message: '这一页还是旧版式，不能在页面上改字。' });
        }
        for (const key of ['category', 'sourceUrl', 'bookId', 'folder'] as const) {
          if (input[key] !== undefined) Object.assign(row, { [key]: input[key] });
        }
        row.html = input.html ?? row.html;
        row.title = input.title ?? row.title;
        row.author = 'user';
        row.updatedAt = this.deps.now().toISOString();
        row.revisions.push({ doc: row.doc, genre: row.genre, html: row.html, change: null, rule: null });
        this.deps.bus?.emit({ type: 'space.changed', spaceId: row.id });
        return this.view(row);
      });
    },
    undo: (id: string, input: UndoSpaceRequest): Promise<SpaceView> => {
      this.deps.session.require();
      return this.deps.receipts.run('save', input.requestId, 'POST /v2/spaces/undo', () => {
        const row = this.space(id);
        const previous = row.revisions.at(-2);
        if (row.revisions.length !== input.version || previous === undefined) {
          throw conflict('没有可以撤回的改动。');
        }
        row.doc = structuredClone(previous.doc);
        row.html = previous.html;
        row.genre = previous.genre;
        row.revisions.push({ ...previous, doc: structuredClone(previous.doc), change: null, rule: null });
        row.updatedAt = this.deps.now().toISOString();
        this.deps.bus?.emit({ type: 'space.changed', spaceId: row.id });
        return this.view(row);
      });
    },
    remove: async (id: string, input: DeleteSpaceRequest): Promise<void> => {
      this.deps.session.require();
      await this.deps.receipts.run('save', input.requestId, 'DELETE /v2/spaces', () => {
        const row = this.space(id);
        if (row.revisions.length !== input.version) {
          throw conflict('这个空间在别处改过了，刷新后再删。');
        }
        row.deletedAt = this.deps.now().toISOString();
        return true;
      });
    },
    restore: (id: string, input: RestoreSpaceRequest): Promise<SpaceView> => {
      this.deps.session.require();
      return this.deps.receipts.run('save', input.requestId, 'POST /v2/spaces/restore', () => {
        const row = this.spaceRows.find((item) => item.id === id);
        if (row === undefined) {
          throw notFound('这个空间');
        }
        row.deletedAt = null;
        this.deps.bus?.emit({ type: 'space.changed', spaceId: row.id });
        return this.view(row);
      });
    },
    asset: async (path: string): Promise<Blob> => {
      this.deps.session.require();
      const asset = SEED_ASSETS[path];
      if (asset === undefined) {
        throw notFound('这张图');
      }
      return new Blob([asset.data], { type: asset.type });
    },
  };

  readonly subscriptions: SubscriptionsApi = {
    list: async (): Promise<SubscriptionListResponse> => {
      this.deps.session.require();
      return { subscriptions: this.subs.map((sub) => {
        const issues = this.issues(sub.id);
        return { id: sub.id, title: sub.title, kind: sub.kind, status: sub.status, latest: issues[0] ?? null,
          issueCount: issues.length };
      }) };
    },
    get: async (id: string): Promise<SubscriptionView> => {
      this.deps.session.require();
      return this.subView(this.subscription(id));
    },
    update: (id: string, input: UpdateSubscriptionRequest): Promise<SubscriptionView> => {
      this.deps.session.require();
      return this.deps.receipts.run('save', input.requestId, 'PUT /v2/subscriptions', () => {
        const sub = this.subscription(id);
        if (sub.version !== input.version) {
          throw conflict('订阅设置在别处改过了，这次没有存。');
        }
        if (input.status === 'active' && this.issues(id).length === 0) {
          throw new ApiError({ kind: 'conflict', code: 'conflict', status: 409,
            message: '还没出过样刊：先出一期，看过再开定时。' });
        }
        return this.subView(this.replaceSub({ ...sub, version: sub.version + 1,
          updatedAt: this.deps.now().toISOString(), title: input.title ?? sub.title,
          settings: input.settings ?? sub.settings, status: input.status ?? sub.status }));
      });
    },
    adoptRule: (id: string, input: AdoptRuleRequest): Promise<SubscriptionView> => {
      this.deps.session.require();
      return this.deps.receipts.run('save', input.requestId, 'POST /v2/subscriptions/rules', () => {
        const sub = this.subscription(id);
        const row = this.space(input.spaceId);
        const rule = row.revisions[input.spaceVersion - 1]?.rule ?? null;
        if (sub.version !== input.version || rule === null) {
          throw conflict('这条规则加不上了，刷新看看。');
        }
        if (sub.settings.rules.some((item) => item.text === rule)) {
          return this.subView(sub);
        }
        const rules = [...sub.settings.rules, { text: rule, fromIssue: row.issueNumber,
          addedAt: this.deps.now().toISOString() }];
        return this.subView(this.replaceSub({ ...sub, version: sub.version + 1,
          settings: { ...sub.settings, rules } }));
      });
    },
    run: (id: string, input: RunSubscriptionRequest): Promise<RunSubscriptionResponse> => {
      this.deps.session.require();
      return this.deps.receipts.run('create', input.requestId, 'POST /v2/subscriptions/run', () => {
        const sub = this.subscription(id);
        const lineId = sub.lineId ?? `line_${sub.id}`;
        this.replaceSub({ ...sub, lineId, lastRunAt: this.deps.now().toISOString() });
        return { lineId };
      });
    },
    review: async (): Promise<ReviewSummary> => {
      this.deps.session.require();
      const latest = this.issues(REVIEW_ID)[0] ?? null;
      const dream = this.deps.dream();
      const live = dream?.changes.filter((change) => !change.undone) ?? [];
      const count = (kind: string): number => live.filter((change) => change.kind === kind).length;
      return { latest, dream: dream === null || live.length === 0 ? null : { finishedAt: dream.finishedAt,
        total: live.length, add: count('add'), replace: count('replace'), unsure: count('unsure') } };
    },
  };

  /** 测试用：Plasticine 刚写好新一期（时间往后挪一分钟，排在最前）。 */
  addIssue(row: SeedSpace): void {
    this.spaceRows.push({ ...row, updatedAt: new Date(this.deps.now().getTime() + ONE_MINUTE_MS).toISOString() });
  }
}
