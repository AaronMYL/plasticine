import { Type, type Static } from 'typebox';
import { API_PREFIX } from './common.ts';

export const DIRECT_OFFER_PATH = `${API_PREFIX}/direct/offer`;

export const DIRECT_STUN_URLS: readonly string[] = [
  'stun:stun.chat.bilibili.com:3478',
  'stun:stun.miwifi.com:3478',
  'stun:stun.cloudflare.com:3478',
];

export const DIRECT_CHUNK_BYTES = 16 * 1024;
export const DIRECT_SDP_MAX_CHARS = 20_000;
export const DIRECT_CHANNEL_LABEL = 'plasticine';

export const DirectOfferRequestSchema = Type.Object({
  sdp: Type.String({ minLength: 1, maxLength: DIRECT_SDP_MAX_CHARS }),
}, { additionalProperties: false });

export const DirectOfferResponseSchema = Type.Object({
  sdp: Type.String({ minLength: 1, maxLength: DIRECT_SDP_MAX_CHARS }),
}, { additionalProperties: false });
export type DirectOfferResponse = Static<typeof DirectOfferResponseSchema>;

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

export const DIRECT_FORWARD_HEADERS: readonly string[] = [
  'accept', 'content-type', 'last-event-id', 'if-none-match', 'if-modified-since', 'range',
  'x-plasticine-replayed', 'x-plasticine-signature', 'x-plasticine-signed-at',
];

const HeadersSchema = Type.Record(Type.String(), Type.String());

export const DirectRequestFrameSchema = Type.Object({
  t: Type.Literal('req'),
  id: Type.Integer({ minimum: 1, maximum: 0xffffffff }),
  method: Type.String({ minLength: 1, maxLength: 10 }),
  path: Type.String({ minLength: 1, maxLength: 4000 }),
  headers: HeadersSchema,
  body: Type.Boolean(),
}, { additionalProperties: false });

export const DirectResponseFrameSchema = Type.Object({
  t: Type.Literal('res'),
  id: Type.Integer({ minimum: 1, maximum: 0xffffffff }),
  status: Type.Integer({ minimum: 100, maximum: 599 }),
  headers: HeadersSchema,
}, { additionalProperties: false });

export const DirectControlFrameSchema = Type.Object({
  t: Type.Union([Type.Literal('end'), Type.Literal('abort'), Type.Literal('err')]),
  id: Type.Integer({ minimum: 1, maximum: 0xffffffff }),
}, { additionalProperties: false });

export const DirectFrameSchema = Type.Union([DirectRequestFrameSchema, DirectResponseFrameSchema,
  DirectControlFrameSchema]);
export type DirectFrame = Static<typeof DirectFrameSchema>;

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
