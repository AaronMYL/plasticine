// Cyber Hunter 隧道的线上格式（2026-11-05 中继独立 + 实例隧道）：每个实例 <handle>.cyberhunter.top 的流量经中继到
// 实例自己。照 frp 的做法：一条带账号签名的控制连接（WSS 到中继主域名），中继要用时在控制连接上说「开一条工作连接
// <id>」，实例另拨一条 TLS（ALPN 是 WORK_ALPN）到主域名、先说 <id> 一行，中继把两条连接对接。中继只转加密字节，
// 不持有实例证书（TLS 直通）。中继（network-relay/）和实例（network/）共用这一份；界面不用。

import { Type, type Static } from 'typebox';

/** 控制连接：WebSocket，升级请求照 /v2/net/* 的账号签名（GET、这个路径、空请求体）。 */
export const TUNNEL_PATH = '/v2/net/tunnel';
/** 工作连接的 ALPN：主域名上同一个 443 端口，靠它和浏览器 / API 请求分开。 */
export const WORK_ALPN = 'cyberhunter-work/1';
/** 两边每 20 秒说一句；60 秒什么都没收到就当这条控制连接死了（断开重连）。 */
export const TUNNEL_HEARTBEAT_MS = 20_000;
export const TUNNEL_DEAD_MS = 60_000;
/** 中继给每条隧道预先开好的工作连接数：来连接时不用等实例现拨。 */
export const TUNNEL_POOL_SIZE = 2;
/** 工作连接 id：32 字节随机数的 base64url。中继只在认证过的控制连接上发它，所以它本身就是工作连接的凭证。 */
export const WORK_ID_PATTERN = '^[A-Za-z0-9_-]{43}$';
/** 工作连接开头那一行最长多少字节（id + 换行，留余量）。 */
export const WORK_LINE_MAX_BYTES = 128;

/**
 * 不给实例用的名字：这些子域名留给系统（以后的网站、邮件、管理入口），短于 3 个字符的也不给（handle 本来就至少 3 个）。
 * 注册账号时也不收这些 handle。
 */
export const RESERVED_HANDLES: ReadonlySet<string> = new Set(['www', 'relay', 'api', 'mail', 'admin', 'cyberhunter']);
export const HANDLE_MIN_LENGTH = 3;

export function isReservedHandle(handle: string): boolean {
  return handle.length < HANDLE_MIN_LENGTH || RESERVED_HANDLES.has(handle);
}

/**
 * handle 允许下划线，域名标签不允许（Let's Encrypt 不签带下划线的名字）：下划线换成连字符。handle 里本来没有连字符，
 * 所以换过去还能一一换回来。
 */
export function hostLabel(handle: string): string {
  return handle.replaceAll('_', '-');
}

export function handleOfLabel(label: string): string {
  return label.replaceAll('-', '_');
}

export function tunnelHost(handle: string, domain: string): string {
  return `${hostLabel(handle)}.${domain}`;
}

// ---------- 控制连接上的话（JSON 文本帧） ----------

const STRICT = { additionalProperties: false };

/** 中继 → 实例：认证过了，你的地址是 host。 */
export const TunnelHelloSchema = Type.Object({ type: Type.Literal('hello'), host: Type.String({ minLength: 1 }) },
  STRICT);
/** 中继 → 实例：拨一条工作连接，开头说这个 id。 */
export const TunnelOpenSchema = Type.Object({
  type: Type.Literal('open'),
  id: Type.String({ pattern: WORK_ID_PATTERN }),
}, STRICT);
/** 两个方向都有：心跳。 */
export const TunnelPingSchema = Type.Object({ type: Type.Literal('ping') }, STRICT);

export const RelayControlMessageSchema = Type.Union([TunnelHelloSchema, TunnelOpenSchema, TunnelPingSchema]);
export type RelayControlMessage = Static<typeof RelayControlMessageSchema>;
export const InstanceControlMessageSchema = TunnelPingSchema;
export type InstanceControlMessage = Static<typeof InstanceControlMessageSchema>;
