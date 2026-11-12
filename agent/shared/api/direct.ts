// 直连（11-12《首次使用解耦》方案第 9～12 条）：手机、别的电脑经 <账号>.cyberhunter.top 打开 Plasticine 后，页面和本体
// 用 WebRTC 打洞连一条数据通道，接口请求（含图片、附件、事件流）走这条通道，不再经中继转；打不通就照旧经中继。
// - 握手：POST /v2/direct/offer（要登录，经中继的端到端 TLS），交 offer 换 answer；通道绑在这次登录会话上。
// - 通道里一套小的「请求 / 回应」帧：文字帧是 JSON（头、结束、出错），二进制帧是 4 字节请求号 + 一块正文。
//   本体把通道里的请求照普通 HTTP 请求同一套鉴权处理。

import { Type, type Static } from 'typebox';
import { API_PREFIX } from './common.ts';

export const DIRECT_OFFER_PATH = `${API_PREFIX}/direct/offer`;

/** 国内能用的公共 STUN 在前（11-12 从腾讯云实测：bilibili 答、小米只在国内答），海外的兜底。 */
export const DIRECT_STUN_URLS: readonly string[] = [
  'stun:stun.chat.bilibili.com:3478',
  'stun:stun.miwifi.com:3478',
  'stun:stun.cloudflare.com:3478',
];

/** 一块正文最多这么大（各家浏览器数据通道一条消息都收得下）。 */
export const DIRECT_CHUNK_BYTES = 16 * 1024;
export const DIRECT_SDP_MAX_CHARS = 20_000;
export const DIRECT_CHANNEL_LABEL = 'plasticine';

export const DirectOfferRequestSchema = Type.Object({
  sdp: Type.String({ minLength: 1, maxLength: DIRECT_SDP_MAX_CHARS }),
}, { additionalProperties: false });
export type DirectOfferRequest = Static<typeof DirectOfferRequestSchema>;

export const DirectOfferResponseSchema = Type.Object({
  sdp: Type.String({ minLength: 1, maxLength: DIRECT_SDP_MAX_CHARS }),
}, { additionalProperties: false });
export type DirectOfferResponse = Static<typeof DirectOfferResponseSchema>;

/**
 * 不走直连的接口：握手本身、登录和账号（要按来源限流、要设 cookie）。其余 /v2/ 都可以。
 * client/public/sw.js 里有同一张表（测试核对）。
 */
export const DIRECT_EXCLUDED_PREFIXES: readonly string[] = [
  `${API_PREFIX}/direct`,
  `${API_PREFIX}/session`,
  `${API_PREFIX}/account`,
  `${API_PREFIX}/auth`,
];

export function directAllowed(path: string): boolean {
  if (!path.startsWith(`${API_PREFIX}/`)) return false;
  return !DIRECT_EXCLUDED_PREFIXES.some((prefix) => path === prefix || path.startsWith(`${prefix}/`)
    || path.startsWith(`${prefix}?`));
}

/** 转给本体时带过去的请求头（别的不带：本机令牌、转发头一概不进）。 */
export const DIRECT_FORWARD_HEADERS: readonly string[] = [
  'accept', 'content-type', 'last-event-id', 'if-none-match', 'if-modified-since', 'range',
  'x-plasticine-replayed', 'x-plasticine-signature', 'x-plasticine-signed-at',
];

const HeadersSchema = Type.Record(Type.String(), Type.String());

/** 页面 → 本体：一个请求开始；body 为 true 时后面跟正文块，再一个 end。 */
export const DirectRequestFrameSchema = Type.Object({
  t: Type.Literal('req'),
  id: Type.Integer({ minimum: 1, maximum: 0xffffffff }),
  method: Type.String({ minLength: 1, maxLength: 10 }),
  path: Type.String({ minLength: 1, maxLength: 4000 }),
  headers: HeadersSchema,
  body: Type.Boolean(),
}, { additionalProperties: false });

/** 本体 → 页面：回应头；正文块跟在后面，最后一个 end。 */
export const DirectResponseFrameSchema = Type.Object({
  t: Type.Literal('res'),
  id: Type.Integer({ minimum: 1, maximum: 0xffffffff }),
  status: Type.Integer({ minimum: 100, maximum: 599 }),
  headers: HeadersSchema,
}, { additionalProperties: false });

/** 两个方向都有：end = 正文完了；abort = 页面不要了；err = 本体那边转不成（页面改走中继）。 */
export const DirectControlFrameSchema = Type.Object({
  t: Type.Union([Type.Literal('end'), Type.Literal('abort'), Type.Literal('err')]),
  id: Type.Integer({ minimum: 1, maximum: 0xffffffff }),
}, { additionalProperties: false });

export const DirectFrameSchema = Type.Union([DirectRequestFrameSchema, DirectResponseFrameSchema,
  DirectControlFrameSchema]);
export type DirectRequestFrame = Static<typeof DirectRequestFrameSchema>;
export type DirectResponseFrame = Static<typeof DirectResponseFrameSchema>;
export type DirectControlFrame = Static<typeof DirectControlFrameSchema>;
export type DirectFrame = Static<typeof DirectFrameSchema>;

/** 二进制帧：前 4 字节是请求号（大端），后面是这一块正文。 */
export function encodeChunk(id: number, data: Uint8Array): Uint8Array<ArrayBuffer> {
  const frame = new Uint8Array(4 + data.byteLength);
  new DataView(frame.buffer).setUint32(0, id);
  frame.set(data, 4);
  return frame;
}

export function decodeChunk(frame: Uint8Array): { id: number; data: Uint8Array } {
  if (frame.byteLength < 4) {
    throw new Error('直连帧太短');
  }
  const id = new DataView(frame.buffer, frame.byteOffset, frame.byteLength).getUint32(0);
  return { id, data: frame.subarray(4) };
}
