// 账号与登录（2026-11-08 他定：去掉设备码，改用「@账号 + 密码」；《讨论/首次使用流程》）。
// 一份 Plasticine 只有一个主人。密码只存在这份 Plasticine 里（加盐慢哈希），中继不知道。
// - 本机（桌面客户端拉起的本体）：壳在启动本体时给一个本机令牌（环境变量 PLASTICINE_LOCAL_TOKEN），只认 127.0.0.1 来的、
//   带 LOCAL_TOKEN_HEADER 的请求；凭它建账号、直接登录、不问旧密码改密码。
// - 服务器（Linux 安装）：装完由 setup-link 命令打印一条一次性的建账号链接（#/setup?t=…，30 分钟、用一次）。
// - 别的设备：@账号（或地址）+ 密码登录。

import { Type, type Static } from 'typebox';
import { DeviceNameSchema } from '../state.ts';
import { API_PREFIX, IsoTimeSchema } from './common.ts';
import { NETWORK_HANDLE_PATTERN } from './network.ts';
import { SessionViewSchema } from './session.ts';

export const ACCOUNT_PATH = `${API_PREFIX}/account`;
export const ACCOUNT_STATE_PATH = `${ACCOUNT_PATH}/state`;
export const ACCOUNT_SETUP_PATH = `${ACCOUNT_PATH}/setup`;
export const ACCOUNT_PASSWORD_PATH = `${ACCOUNT_PATH}/password`;
/** GET …/handles/:handle：这个 @账号能不能用（问中继）。 */
export const ACCOUNT_HANDLES_PATH = `${ACCOUNT_PATH}/handles`;
export const PASSWORD_SESSION_PATH = `${API_PREFIX}/session/password`;
export const LOCAL_SESSION_PATH = `${API_PREFIX}/session/local`;
/** GET / PUT（要登录）：「我自己的网址」——经自己的隧道或反向代理在别的设备上打开这份 Plasticine。 */
export const ACCOUNT_OWN_URL_PATH = `${ACCOUNT_PATH}/own-url`;

/** 壳给本机本体的令牌放在这个请求头里；只在 127.0.0.1 上认。 */
export const LOCAL_TOKEN_HEADER = 'x-plasticine-local-token';
export const LOCAL_TOKEN_ENV = 'PLASTICINE_LOCAL_TOKEN';

export const PASSWORD_MIN_CHARS = 8;
export const PASSWORD_MAX_CHARS = 200;
export const PasswordSchema = Type.String({ minLength: PASSWORD_MIN_CHARS, maxLength: PASSWORD_MAX_CHARS });
export const DISPLAY_NAME_MAX_CHARS = 40;
export const DisplayNameSchema = Type.String({ minLength: 1, maxLength: DISPLAY_NAME_MAX_CHARS });
/**
 * @账号：小写字母、数字、下划线，3–24 位。和中继的 handle 规则是同一条（NETWORK_HANDLE_PATTERN、net-wire 的
 * NET_HANDLE_PATTERN）：中继早就这样定了，已经起好的 @账号都是这个样子；连字符留给 <handle>.cyberhunter.top 的
 * 域名标签（下划线在域名里换成连字符）。
 */
export const HandleSchema = Type.String({ pattern: NETWORK_HANDLE_PATTERN });
/** 建账号链接里的一次性令牌（setup-link 命令打印）。 */
export const SetupTokenSchema = Type.String({ minLength: 8, maxLength: 64 });
/** 建账号链接 30 分钟内有效、只能用一次（设计稿 Linux-Install）。 */
export const SETUP_TOKEN_TTL_MS = 30 * 60 * 1000;

/**
 * GET /v2/account/state（不用登录）：登录页、建账号页、桌面客户端开始页都先读它。
 * setup：needed = 还没有主人（没有密码、也没有登录过的设备），要先建账号；done = 已经有主人。
 * handle / displayName：已经起好的 @账号和名字（登录页预填）；还没有就是 null。
 * passwordSet：false 是老实例（有登录着的设备、还没设密码），已登录的界面要弹一次「设一个密码」。
 * networkUrl：@账号对应的网址（https://<账号>.cyberhunter.top），没加入网络是 null。
 */
export const AccountStateSchema = Type.Object({
  setup: Type.Union([Type.Literal('needed'), Type.Literal('done')]),
  handle: Type.Union([HandleSchema, Type.Null()]),
  displayName: Type.Union([Type.String(), Type.Null()]),
  passwordSet: Type.Boolean(),
  networkUrl: Type.Union([Type.String(), Type.Null()]),
}, { additionalProperties: false });
export type AccountState = Static<typeof AccountStateSchema>;

/**
 * POST /v2/account/setup（不用登录）：建账号。只在 setup = needed 时成；凭本机令牌（请求头）或 setupToken 之一。
 * handle 为 null：先不起 @账号（不加入网络），以后在 设置 · 账号 里起。
 * 成功：设好名字和密码；起了 handle 就在网络里注册；登记这台设备并发会话（Set-Cookie）；在主线放一条欢迎消息。
 */
export const AccountSetupRequestSchema = Type.Object({
  displayName: DisplayNameSchema,
  handle: Type.Union([HandleSchema, Type.Null()]),
  password: PasswordSchema,
  deviceName: DeviceNameSchema,
  setupToken: Type.Optional(SetupTokenSchema),
}, { additionalProperties: false });
export type AccountSetupRequest = Static<typeof AccountSetupRequestSchema>;

/** 建账号的回执：会话，加上网络注册的结果（没注册成不挡建账号，problem 写一句原因，以后在设置里再试）。 */
export const AccountSetupResponseSchema = Type.Object({
  session: SessionViewSchema,
  network: Type.Object({
    joined: Type.Boolean(),
    url: Type.Union([Type.String(), Type.Null()]),
    problem: Type.Union([Type.String(), Type.Null()]),
  }, { additionalProperties: false }),
}, { additionalProperties: false });
export type AccountSetupResponse = Static<typeof AccountSetupResponseSchema>;

/** GET /v2/account/handles/:handle（不用登录）：能不能用；不能用时 reason 给一句（被占了、格式不对、留用词）。 */
export const HandleAvailabilitySchema = Type.Object({
  handle: Type.String(),
  available: Type.Boolean(),
  reason: Type.Union([Type.Literal('taken'), Type.Literal('invalid'), Type.Literal('reserved'),
    Type.Literal('unreachable'), Type.Null()]),
}, { additionalProperties: false });
export type HandleAvailability = Static<typeof HandleAvailabilitySchema>;

/** POST /v2/session/password（不用登录）：密码登录；成功登记这台设备并发会话（201 + Set-Cookie，回 SessionView）。 */
export const PasswordSessionRequestSchema = Type.Object({
  password: Type.String({ minLength: 1, maxLength: PASSWORD_MAX_CHARS }),
  deviceName: DeviceNameSchema,
}, { additionalProperties: false });
export type PasswordSessionRequest = Static<typeof PasswordSessionRequestSchema>;

/** POST /v2/session/local（不用登录，要本机令牌请求头、只认 127.0.0.1）：壳替本机界面登录（回 SessionView）。 */
export const LocalSessionRequestSchema = Type.Object({ deviceName: DeviceNameSchema },
  { additionalProperties: false });
export type LocalSessionRequest = Static<typeof LocalSessionRequestSchema>;

/**
 * PUT /v2/account/password（要登录）：改密码 / 第一次设密码。current：已经设过密码时要填旧密码；
 * 还没设过（老实例）或带本机令牌请求头时不用。改了以后别的设备的会话照旧（要退出某台在设备列表里点）。
 */
export const AccountPasswordRequestSchema = Type.Object({
  current: Type.Optional(Type.String({ maxLength: PASSWORD_MAX_CHARS })),
  password: PasswordSchema,
}, { additionalProperties: false });
export type AccountPasswordRequest = Static<typeof AccountPasswordRequestSchema>;

export const AccountPasswordResponseSchema = Type.Object({ passwordSetAt: IsoTimeSchema },
  { additionalProperties: false });
export type AccountPasswordResponse = Static<typeof AccountPasswordResponseSchema>;

/** PATCH /v2/account（要登录）：改名字。 */
export const AccountPatchRequestSchema = Type.Object({ displayName: DisplayNameSchema },
  { additionalProperties: false });
export type AccountPatchRequest = Static<typeof AccountPatchRequestSchema>;

/**
 * 「在别的设备上用」的自己的网址（11-12《首次使用解耦》）：只收 https、不带路径以外的东西；null = 没设。
 * 设了以后 Plasticine 写给他的链接用这个网址。不进 GET /v2/account/state（那个不用登录）。
 */
export const OWN_URL_MAX_CHARS = 300;
export const OwnUrlViewSchema = Type.Object({
  ownUrl: Type.Union([Type.String({ maxLength: OWN_URL_MAX_CHARS }), Type.Null()]),
}, { additionalProperties: false });
export type OwnUrlView = Static<typeof OwnUrlViewSchema>;
export const OwnUrlRequestSchema = OwnUrlViewSchema;
export type OwnUrlRequest = OwnUrlView;

/** 欢迎消息下面的「开始」（schema 在 shared/welcome-start.ts：线的视图也要用，放在不引别的文件的那一份里）。 */
export { WelcomeStartSchema, type WelcomeStart } from '../welcome-start.ts';
