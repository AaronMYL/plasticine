// SPDX-License-Identifier: Apache-2.0

import { Type, type Static } from 'typebox';

export const TUNNEL_PATH = '/v2/net/tunnel';
export const WORK_ALPN = 'cyberhunter-work/1';
export const TUNNEL_HEARTBEAT_MS = 20_000;
export const TUNNEL_DEAD_MS = 60_000;
export const TUNNEL_POOL_SIZE = 2;
export const WORK_ID_PATTERN = '^[A-Za-z0-9_-]{43}$';
export const WORK_LINE_MAX_BYTES = 128;

export const RESERVED_HANDLES: ReadonlySet<string> = new Set(['www', 'relay', 'api', 'mail', 'admin', 'cyberhunter']);
export const HANDLE_MIN_LENGTH = 3;

export function isReservedHandle(handle: string): boolean {
  return handle.length < HANDLE_MIN_LENGTH || RESERVED_HANDLES.has(handle);
}

export function hostLabel(handle: string): string {
  return handle.replaceAll('_', '-');
}

export function handleOfLabel(label: string): string {
  return label.replaceAll('-', '_');
}

export function tunnelHost(handle: string, domain: string): string {
  return `${hostLabel(handle)}.${domain}`;
}

const STRICT = { additionalProperties: false };

export const TunnelHelloSchema = Type.Object({ type: Type.Literal('hello'), host: Type.String({ minLength: 1 }) },
  STRICT);
export const TunnelOpenSchema = Type.Object({
  type: Type.Literal('open'),
  id: Type.String({ pattern: WORK_ID_PATTERN }),
}, STRICT);
export const TunnelPingSchema = Type.Object({ type: Type.Literal('ping') }, STRICT);

export const RelayControlMessageSchema = Type.Union([TunnelHelloSchema, TunnelOpenSchema, TunnelPingSchema]);
export type RelayControlMessage = Static<typeof RelayControlMessageSchema>;
export const InstanceControlMessageSchema = TunnelPingSchema;
export type InstanceControlMessage = Static<typeof InstanceControlMessageSchema>;
