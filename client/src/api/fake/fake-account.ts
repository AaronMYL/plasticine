// 假的账号与密码登录（11-08 首次使用流程，agent/shared/api/account.ts）：和真服务端一样——
// - 建账号只在还没有主人时成，要本机令牌（请求头）或建账号链接里的 setupToken；成了登记这台设备、发会话、
//   起了 @账号就在网络里注册、在主线放一条欢迎消息；
// - 密码登录连错几次就限流（429）；带本机令牌改密码不要旧密码；老实例（passwordSet = false）第一次设也不要。
// 密码只在内存里，测试里用明显是假的值。

import type { AccountApi } from '../account-client.ts';
import { ApiError } from '../errors.ts';
import type {
  AccountPasswordRequest,
  AccountPasswordResponse,
  AccountSetupRequest,
  AccountSetupResponse,
  AccountState,
  HandleAvailability,
  OwnUrlView,
  PasswordSessionRequest,
  SessionView,
  WelcomeStart,
} from '../shared.ts';
import { HandleSchema, PASSWORD_MIN_CHARS } from '../shared.ts';
import { Value } from 'typebox/value';
import { MAIN_LINE_ID, type FakeLines } from './fake-lines.ts';
import type { FakeNetwork } from './fake-network.ts';
import type { FakeSession } from './fake-session.ts';

/** 假的本机令牌、建账号链接令牌（测试和本地开发用；真的由壳 / setup-link 命令给）。 */
export const FAKE_LOCAL_TOKEN = 'fake-local-token';
export const FAKE_SETUP_TOKEN = 'fake-setup-token';
/** 连错这么多次以后限流（真服务端沿用配对码的限流做法）。 */
const SIGN_IN_FAILURES_MAX = 5;
/** 被占了、留用的 @账号（假的中继）。 */
const TAKEN = new Set(['taken', 'you', 'sam', 'xiaolin']);
const RESERVED = new Set(['admin', 'plasticine', 'www', 'relay']);

/** 欢迎消息下面的三个开始（设计稿 First-Main）。 */
export const WELCOME_STARTS: readonly WelcomeStart[] = [
  { id: 'import-notes', label: '导入我的笔记', icon: 'notes', prompt: '帮我把现有的笔记导进来。' },
  { id: 'subscribe-feeds', label: '订几个信息源', icon: 'feed', prompt: '帮我订几个值得看的信息源。' },
  { id: 'get-to-know', label: '先聊聊，认识一下', icon: 'conversation', prompt: '先聊聊吧，你想先了解我什么？' },
];

export function welcomeText(name: string): string {
  return `你好 ${name}。你说一件事，我能查资料、整理笔记、替你盯着信息流，也能用这台电脑替你动手；`
    + '以你名义对外、花钱、删东西之前，都会先问你。\n\n想从哪儿开始？';
}

interface FakeAccountDeps {
  session: FakeSession;
  network: FakeNetwork;
  lines: () => FakeLines;
  now: () => Date;
}

export class FakeAccount implements AccountApi {
  private fresh = false;
  private password: string | null = 'fake-password';
  private passwordSetAt: string | null = null;
  private displayName = 'Alex';
  private failures = 0;
  private own: string | null = null;
  private readonly deps: FakeAccountDeps;

  constructor(deps: FakeAccountDeps) {
    this.deps = deps;
  }

  /** 场景：新装、还没有主人（建账号页）。 */
  seedFresh(): void {
    this.fresh = true;
    this.password = null;
  }

  /** 场景：老实例，登录着、还没设密码（弹一次「设一个密码」）。 */
  seedNoPassword(): void {
    this.password = null;
  }

  seedName(displayName: string): void {
    this.displayName = displayName;
  }

  /** 测试：现在的密码（只在假实现里能读）。 */
  currentPassword(): string | null {
    return this.password;
  }

  async state(): Promise<AccountState> {
    return this.snapshot();
  }

  async handle(handle: string): Promise<HandleAvailability> {
    if (!Value.Check(HandleSchema, handle)) {
      return { handle, available: false, reason: 'invalid' };
    }
    if (RESERVED.has(handle)) {
      return { handle, available: false, reason: 'reserved' };
    }
    if (TAKEN.has(handle)) {
      return { handle, available: false, reason: 'taken' };
    }
    return { handle, available: true, reason: null };
  }

  async setup(input: AccountSetupRequest, localToken: string | null): Promise<AccountSetupResponse> {
    if (!this.fresh) {
      throw new ApiError({ kind: 'failed', code: 'already_set_up', status: 409, message: '这份 Plasticine 已经有主人了。',
        next: '用 @账号和密码登录。' });
    }
    if (localToken !== FAKE_LOCAL_TOKEN && input.setupToken !== FAKE_SETUP_TOKEN) {
      throw new ApiError({ kind: 'invalid', code: 'setup_token_invalid', status: 403,
        message: '建账号链接过期了，或者不是在这台电脑上打开的。', next: '在装着 Plasticine 的电脑上重新打开。' });
    }
    if (input.handle !== null && !(await this.handle(input.handle)).available) {
      throw new ApiError({ kind: 'invalid', code: 'handle_taken', status: 409, field: 'handle',
        message: `@${input.handle} 用不了。`, next: '换一个。' });
    }
    this.fresh = false;
    this.displayName = input.displayName;
    this.setPasswordNow(input.password);
    const session = this.deps.session.signInAs(input.deviceName);
    if (input.handle !== null) {
      this.deps.network.register(input.handle, input.displayName);
    }
    this.postWelcome();
    const url = this.networkUrl();
    return { session, network: { joined: url !== null, url, problem: null } };
  }

  async signIn(input: PasswordSessionRequest): Promise<SessionView> {
    if (this.failures >= SIGN_IN_FAILURES_MAX) {
      throw new ApiError({ kind: 'failed', code: 'too_many_attempts', status: 429, message: '试错太多次了。',
        next: '过一会儿再试。' });
    }
    if (this.password === null || input.password !== this.password) {
      this.failures += 1;
      throw new ApiError({ kind: 'invalid', code: 'login_failed', status: 401, field: 'password',
        message: '密码不对。' });
    }
    this.failures = 0;
    return this.deps.session.signInAs(input.deviceName);
  }

  async signInLocal(deviceName: string, localToken: string): Promise<SessionView> {
    if (localToken !== FAKE_LOCAL_TOKEN) {
      throw new ApiError({ kind: 'invalid', code: 'local_only', status: 403,
        message: '只有这台电脑上的 Plasticine 能这样登录。', next: '用 @账号和密码登录。' });
    }
    return this.deps.session.signInAs(deviceName, true);
  }

  async setPassword(input: AccountPasswordRequest, localToken: string | null): Promise<AccountPasswordResponse> {
    this.deps.session.require();
    if (input.password.length < PASSWORD_MIN_CHARS) {
      throw new ApiError({ kind: 'invalid', code: 'invalid_request', status: 400, field: 'password',
        message: `密码至少 ${PASSWORD_MIN_CHARS} 位。` });
    }
    const needsCurrent = this.password !== null && localToken !== FAKE_LOCAL_TOKEN;
    if (needsCurrent && input.current !== this.password) {
      throw new ApiError({ kind: 'invalid', code: 'password_wrong', status: 400, field: 'current',
        message: '旧密码不对。' });
    }
    this.setPasswordNow(input.password);
    return { passwordSetAt: this.passwordSetAt ?? this.deps.now().toISOString() };
  }

  async rename(displayName: string): Promise<AccountState> {
    this.deps.session.require();
    this.displayName = displayName;
    this.deps.network.rename(displayName);
    return this.snapshot();
  }

  async ownUrl(): Promise<OwnUrlView> {
    this.deps.session.require();
    return { ownUrl: this.own };
  }

  async setOwnUrl(ownUrl: string | null): Promise<OwnUrlView> {
    this.deps.session.require();
    if (ownUrl === null || ownUrl.trim() === '') {
      this.own = null;
      return { ownUrl: null };
    }
    let url: URL | null = null;
    try {
      url = new URL(ownUrl.trim());
    } catch {
      url = null;
    }
    if (url === null || url.protocol !== 'https:' || url.pathname !== '/' || url.search !== '' || url.username !== '') {
      throw new ApiError({ kind: 'invalid', code: 'invalid_request', status: 400, field: 'ownUrl',
        message: '要填 https 开头的网址，不带路径、查询和登录信息，比如 https://plasticine.example.com。' });
    }
    this.own = url.origin;
    return { ownUrl: this.own };
  }

  /** 服务端建账号时放的那条欢迎消息（本地开发的「第一次进主线」场景也用）。 */
  postWelcome(): void {
    this.deps.lines().record(MAIN_LINE_ID, { role: 'welcome', text: welcomeText(this.displayName), thinking: null,
      thinkingMs: null, steps: [], toolCallId: null, tool: null, say: null, ok: null, summary: null, stopReason: null,
      childLineId: null, attachments: [], widgets: [], starts: [...WELCOME_STARTS],
      createdAt: this.deps.now().toISOString() });
  }

  private setPasswordNow(password: string): void {
    this.password = password;
    this.passwordSetAt = this.deps.now().toISOString();
  }

  private networkUrl(): string | null {
    const account = this.deps.network.accountNow();
    if (account === null) {
      return null;
    }
    return `https://${account.host ?? `${account.handle.replace(/_/g, '-')}.cyberhunter.top`}`;
  }

  private snapshot(): AccountState {
    const account = this.deps.network.accountNow();
    return {
      setup: this.fresh ? 'needed' : 'done',
      handle: account?.handle ?? null,
      displayName: this.fresh ? null : account?.displayName ?? this.displayName,
      passwordSet: this.password !== null,
      networkUrl: this.networkUrl(),
    };
  }
}
