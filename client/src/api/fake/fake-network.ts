// 假的网络账号和对外可见（第 113 条）。网络：没加入时可以加入（中继里还没有账号时第一个免邀请码，就是实例主人自己的实例；
// 之后要码），加入后能生成邀请码（每个账号最多 20 个没用掉的，14 天过期）。对外可见：三类联系人的人数从假联系人数，
// 材料各有档位和 Plasticine 的建议；定档带 version，确认把建议变成档位。写操作按 requestId 幂等。

import type {
  ConfirmMarksRequest,
  CreateInviteRequest,
  JoinNetworkRequest,
  NetworkApi,
  NetworkInviteResponse,
  SetAvatarRequest,
  SetMarkRequest,
  VisibilityApi,
} from '../contacts-client.ts';
import { ApiError, ConflictError } from '../errors.ts';
import {
  CONTACT_RELATIONS,
  NETWORK_HANDLE_PATTERN,
  type ContactRelation,
  type MaterialRow,
  type NetworkInvite,
  type NetworkStatus,
  type VisibilityResponse,
} from '../shared.ts';
import type { FakeSession } from './fake-session.ts';
import type { FakeReceipts } from './receipts.ts';

/** 默认中继（规格第 1 节）。 */
export const DEFAULT_RELAY_URL = 'https://cyberhunter.top';
/** 邀请码 14 天过期、每个账号最多 20 个没用掉的（规格第 3 节）。 */
const INVITE_DAYS = 14;
const INVITE_UNUSED_MAX = 20;
const DAY_MS = 86_400_000;
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export interface FakeNetworkDeps {
  session: FakeSession;
  receipts: FakeReceipts;
  now: () => Date;
}

function refused(message: string, next?: string): ApiError {
  return new ApiError({ kind: 'failed', code: 'conflict', message, next, status: 409 });
}

export class FakeNetwork implements NetworkApi {
  /** 中继里还没有账号：这次加入免邀请码。 */
  relayEmpty = true;
  private state: NetworkStatus = {
    joined: false,
    relayUrl: DEFAULT_RELAY_URL,
    account: null,
    lastSyncAt: null,
    lastError: null,
    inviteNeeded: false,
  };
  private readonly issued: NetworkInvite[] = [];
  private readonly deps: FakeNetworkDeps;
  private sequence = 0;

  constructor(deps: FakeNetworkDeps) {
    this.deps = deps;
  }

  /** 新装的实例（第一次打开的三步）。 */
  welcome = false;

  /** 测试：和中继同步出了错（null = 好了）。 */
  fail(message: string | null): void {
    this.state.lastError = message;
  }

  async status(): Promise<NetworkStatus> {
    this.deps.session.require();
    return { ...structuredClone(this.state), inviteNeeded: !this.state.joined && !this.relayEmpty,
      welcome: this.welcome && !this.state.joined };
  }

  /** 截图场景：新装、没加入、中继上已经有人（要邀请码）。 */
  seedWelcome(): void {
    this.welcome = true;
    this.relayEmpty = false;
  }

  async setAvatar(input: SetAvatarRequest): Promise<NetworkStatus> {
    this.deps.session.require();
    return this.deps.receipts.run('network', input.requestId, 'POST /v2/network/avatar', () => {
      if (this.state.account === null) {
        throw refused('还没加入网络。');
      }
      this.state = { ...this.state, account: { ...this.state.account, avatar: input.avatar } };
      return { ...structuredClone(this.state), inviteNeeded: false };
    });
  }

  async join(input: JoinNetworkRequest): Promise<NetworkStatus> {
    this.deps.session.require();
    return this.deps.receipts.run('network', input.requestId, 'POST /v2/network/join', () => {
      if (this.state.joined) {
        throw refused('这台 Plasticine 已经加入了。');
      }
      if (!new RegExp(NETWORK_HANDLE_PATTERN).test(input.handle)) {
        throw new ApiError({ kind: 'invalid', code: 'invalid_request', status: 400, field: 'handle',
          message: '@handle 只能是 3–24 位小写字母、数字或下划线。' });
      }
      const code = input.inviteCode?.trim() ?? '';
      if (!this.relayEmpty && code === '') {
        throw new ApiError({ kind: 'invalid', code: 'invalid_request', status: 400, field: 'inviteCode',
          message: '加入要邀请码。', next: '请已经加入的朋友在他的「设置 · 账号与网络」里生成一个。' });
      }
      this.applyJoin(input);
      return structuredClone(this.state);
    });
  }

  async createInvite(input: CreateInviteRequest): Promise<NetworkInviteResponse> {
    this.deps.session.require();
    return this.deps.receipts.run('network', input.requestId, 'POST /v2/network/invites', () => {
      if (!this.state.joined) {
        throw refused('还没加入网络，生成不了邀请码。', '先在上面加入。');
      }
      if (this.issued.filter((invite) => invite.usedBy === null).length >= INVITE_UNUSED_MAX) {
        throw refused(`没用掉的邀请码已经有 ${INVITE_UNUSED_MAX} 个了。`, '等朋友用掉几个再生成。');
      }
      const invite = this.issue();
      return { invite, shareText: shareTextOf(this.state.relayUrl, invite.code) };
    });
  }

  async invites(): Promise<NetworkInvite[]> {
    this.deps.session.require();
    return structuredClone([...this.issued].reverse());
  }

  /** 建账号时起的 @账号（fake-account.ts）：直接在网络里注册，不要邀请码（11-08 决定 4）。 */
  register(handle: string, displayName: string): void {
    this.applyJoin({ requestId: `req_setup_${handle}`, handle, displayName });
  }

  /** 网络上的账号（同步读，不要会话：账号状态不用登录也能读）；没加入是 null。 */
  accountNow(): NetworkStatus['account'] {
    return this.state.account;
  }

  /** 设置 · 账号改名字时网络上的显示名跟着改。 */
  rename(displayName: string): void {
    if (this.state.account !== null) {
      this.state = { ...this.state, account: { ...this.state.account, displayName } };
    }
  }

  /** 预置：已经加入、发过一个码且被用掉（本地开发）。 */
  seedJoined(handle: string, displayName: string): void {
    this.applyJoin({ requestId: 'req_seed_join', handle, displayName });
    const used = this.issue();
    used.usedBy = 'linyi';
  }

  private applyJoin(input: JoinNetworkRequest): void {
    const at = this.deps.now().toISOString();
    this.state = {
      joined: true,
      relayUrl: input.relayUrl ?? this.state.relayUrl,
      account: { id: `acct_${input.handle}`, handle: input.handle, displayName: input.displayName, joinedAt: at,
        avatar: null, host: `${input.handle.replace(/_/g, '-')}.cyberhunter.top` },
      tunnel: { state: 'ready', detail: `${input.handle.replace(/_/g, '-')}.cyberhunter.top` },
      lastSyncAt: at,
      lastError: null,
      inviteNeeded: false,
    };
    this.relayEmpty = false;
  }

  private issue(): NetworkInvite {
    this.sequence += 1;
    const now = this.deps.now();
    const invite: NetworkInvite = {
      code: inviteCodeOf(this.sequence),
      createdAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + INVITE_DAYS * DAY_MS).toISOString(),
      usedBy: null,
    };
    this.issued.push(invite);
    return invite;
  }
}

function inviteCodeOf(sequence: number): string {
  let seed = sequence * 7_919 + 104_729;
  const chars: string[] = [];
  for (let index = 0; index < 8; index += 1) {
    seed = (seed * 48_271) % 2_147_483_647;
    chars.push(CODE_ALPHABET[seed % CODE_ALPHABET.length] ?? 'X');
  }
  return `CH-${chars.slice(0, 4).join('')}-${chars.slice(4).join('')}`;
}

/** 和服务端同一个样子（2026-11-05 设计稿 Invite）：三行，下载地址在中继的主域名上。 */
export function shareTextOf(_relayUrl: string, code: string): string {
  return `我在用 Plasticine，邀请你加入。\n下载：https://cyberhunter.top/download/\n装好后填邀请码 ${code}`;
}

export interface FakeVisibilityDeps {
  session: FakeSession;
  receipts: FakeReceipts;
  relationCounts: () => Record<ContactRelation, number>;
  /** 定了档：记忆页上那一篇的档位跟着变。 */
  marked?: (row: MaterialRow) => void;
}

export class FakeVisibility implements VisibilityApi {
  private materials: MaterialRow[] = [];
  private readonly deps: FakeVisibilityDeps;

  constructor(deps: FakeVisibilityDeps) {
    this.deps = deps;
  }

  async get(): Promise<VisibilityResponse> {
    this.deps.session.require();
    return this.view();
  }

  async mark(input: SetMarkRequest): Promise<VisibilityResponse> {
    this.deps.session.require();
    return this.deps.receipts.run('visibility', input.requestId, 'POST /v2/visibility/marks', () => {
      // 记忆页上新起的一篇（技能、话题）还没在材料表里：第一次定档时补一行（同真服务端 version 0 = 还没有这一行）。
      const row = this.materials.find((material) => material.kind === input.kind && material.id === input.id)
        ?? (input.version === 0 ? this.adopt(input) : undefined);
      if (row === undefined) {
        throw new ApiError({ kind: 'not_found', code: 'not_found', message: '没有找到这条材料。', status: 404 });
      }
      if (row.version !== input.version) {
        throw new ConflictError(row, '这条材料的档位在别处改过了，这次没有改。', '看最新的再定。');
      }
      const next = { ...row, tier: input.tier, proposed: null, version: row.version + 1 };
      this.replace(next);
      this.deps.marked?.(next);
      return this.view();
    });
  }

  async confirm(input: ConfirmMarksRequest): Promise<VisibilityResponse> {
    this.deps.session.require();
    return this.deps.receipts.run('visibility', input.requestId, 'POST /v2/visibility/confirm', () => {
      const picked = (row: MaterialRow): boolean => input.items === undefined
        || input.items.some((item) => item.kind === row.kind && item.id === row.id);
      this.materials = this.materials.map((row) => (row.proposed !== null && picked(row)
        ? { ...row, tier: row.proposed, proposed: null, version: row.version + 1 } : row));
      return this.view();
    });
  }

  seed(rows: readonly MaterialRow[]): void {
    this.materials = structuredClone([...rows]);
  }

  private adopt(input: SetMarkRequest): MaterialRow {
    const row: MaterialRow = { kind: input.kind, id: input.id, title: input.id, tier: 'private', proposed: null,
      version: 0 };
    this.materials = [...this.materials, row];
    return row;
  }

  private replace(next: MaterialRow): void {
    this.materials = this.materials.map((row) => (row.kind === next.kind && row.id === next.id ? next : row));
  }

  private view(): VisibilityResponse {
    const counts = this.deps.relationCounts();
    return {
      relations: CONTACT_RELATIONS.map((relation) => ({ relation, count: counts[relation] })),
      materials: structuredClone(this.materials),
      pending: this.materials.filter((row) => row.proposed !== null).length,
    };
  }
}
