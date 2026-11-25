// SPDX-License-Identifier: Apache-2.0

import type { TSchema, Static } from 'typebox';
import { Value } from 'typebox/value';
import {
  AckResponseSchema,
  EnvelopesResponseSchema,
  NET_ACCOUNTS_PATH,
  NET_ACK_PATH,
  NET_BLOCKS_PATH,
  NET_ENVELOPES_PATH,
  NET_HANDLES_PATH,
  NET_HEADERS,
  NET_INVITES_PATH,
  NET_TASKS_PATH,
  NetAccountResponseSchema,
  NetHandleCheckSchema,
  NetInviteCheckSchema,
  NetInviteResponseSchema,
  NetInvitesResponseSchema,
  NetTaskStatusesResponseSchema,
  OkResponseSchema,
  PostEnvelopeResponseSchema,
  type Envelope,
  type EnvelopesResponse,
  type NetAccount,
  type NetHandleCheck,
  type NetInvite,
  type NetTaskStatus,
  type NetTaskStatusRecord,
  type RegisterAccountRequest,
} from '../shared/net-wire.ts';
import { newNonce, requestSigningText, signText } from './crypto.ts';

export const DEFAULT_RELAY_URL = 'https://cyberhunter.top';
export const LEGACY_RELAY_URLS: ReadonlySet<string> = new Set(['http://127.0.0.1:8790', 'http://localhost:8790']);

export function effectiveRelayUrl(stored: string | undefined, configured: string): string {
  if (stored === undefined) {
    return checkRelayUrl(configured);
  }
  const origin = checkRelayUrl(stored);
  return LEGACY_RELAY_URLS.has(origin) ? checkRelayUrl(configured) : origin;
}
const REQUEST_TIMEOUT_MS = 15_000;
const POLL_MARGIN_MS = 10_000;

export type RelayFailure = 'network' | 'refused';

export class RelayCallError extends Error {
  readonly kind: RelayFailure;
  readonly status: number | null;
  readonly code: string | null;

  constructor(kind: RelayFailure, message: string, status: number | null = null, code: string | null = null) {
    super(message);
    this.name = 'RelayCallError';
    this.kind = kind;
    this.status = status;
    this.code = code;
  }
}

export interface Signer {
  accountId: string | null;
  signingPrivateKey: string;
}

export interface RelayClientOptions {
  baseUrl: string;
  now: () => Date;
  fetch?: typeof fetch;
}

interface Call {
  method: 'GET' | 'POST' | 'DELETE';
  path: string;
  body?: unknown;
  signer: Signer | null;
  timeoutMs?: number;
  signal?: AbortSignal;
}

export function signedHeaders(signer: Signer, method: string, path: string, body: Buffer, now: Date):
  Record<string, string> {
  const time = now.toISOString();
  const nonce = newNonce();
  const headers: Record<string, string> = {
    [NET_HEADERS.time]: time,
    [NET_HEADERS.nonce]: nonce,
    [NET_HEADERS.signature]: signText(signer.signingPrivateKey, requestSigningText({ method, path, time, nonce,
      body })),
  };
  if (signer.accountId !== null) {
    headers[NET_HEADERS.account] = signer.accountId;
  }
  return headers;
}

export function checkRelayUrl(url: string): string {
  const parsed = new URL(url);
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username !== '' || parsed.password !== '') {
    throw new Error('中继地址要是不带登录信息的 http(s) 地址');
  }
  return parsed.origin;
}

export class RelayClient {
  readonly #base: string;
  readonly #now: () => Date;
  readonly #fetch: typeof fetch;

  constructor(options: RelayClientOptions) {
    this.#base = checkRelayUrl(options.baseUrl);
    this.#now = options.now;
    this.#fetch = options.fetch ?? fetch;
  }

  get baseUrl(): string {
    return this.#base;
  }

  async #call<S extends TSchema>(call: Call, schema: S): Promise<Static<S>> {
    const url = new URL(call.path, this.#base);
    const body = call.body === undefined ? Buffer.alloc(0) : Buffer.from(JSON.stringify(call.body));
    const headers: Record<string, string> = {};
    if (call.body !== undefined) {
      headers['content-type'] = 'application/json';
    }
    if (call.signer !== null) {
      Object.assign(headers, signedHeaders(call.signer, call.method, `${url.pathname}${url.search}`, body,
        this.#now()));
    }
    const timeout = AbortSignal.timeout(call.timeoutMs ?? REQUEST_TIMEOUT_MS);
    const signal = call.signal === undefined ? timeout : AbortSignal.any([call.signal, timeout]);
    let response: Response;
    try {
      response = await this.#fetch(url, { method: call.method, headers, signal,
        ...(call.body === undefined ? {} : { body }) });
    } catch (cause) {
      if (call.signal?.aborted === true) {
        throw cause;
      }
      throw new RelayCallError('network', '连不上中继，稍后自动再试。');
    }
    const value: unknown = await response.json().catch(() => null);
    if (response.status >= 500) {
      throw new RelayCallError('network', '中继出错了，稍后自动再试。', response.status);
    }
    if (response.status >= 400) {
      const record = typeof value === 'object' && value !== null ? value as Record<string, unknown> : {};
      const message = typeof record['error'] === 'string' ? record['error'] : '中继拒绝了这次请求。';
      const code = typeof record['code'] === 'string' ? record['code'] : null;
      throw new RelayCallError('refused', message, response.status, code);
    }
    if (!Value.Check(schema, value)) {
      throw new RelayCallError('network', '中继回的内容不合格式。', response.status);
    }
    return value;
  }

  async register(input: RegisterAccountRequest, signingPrivateKey: string): Promise<NetAccount> {
    return (await this.registerFor(input, signingPrivateKey)).account;
  }

  async registerFor(input: RegisterAccountRequest, signingPrivateKey: string):
    Promise<{ account: NetAccount; invitedBy: string | null }> {
    const reply = await this.#call({ method: 'POST', path: NET_ACCOUNTS_PATH, body: input,
      signer: { accountId: null, signingPrivateKey } }, NetAccountResponseSchema);
    return { account: reply.account, invitedBy: reply.invitedBy ?? null };
  }

  async account(signer: Signer, handle: string): Promise<NetAccount> {
    const path = `${NET_ACCOUNTS_PATH}/${encodeURIComponent(handle)}`;
    return (await this.#call({ method: 'GET', path, signer }, NetAccountResponseSchema)).account;
  }

  async accountById(signer: Signer, id: string): Promise<NetAccount> {
    const path = `${NET_ACCOUNTS_PATH}/by-id/${encodeURIComponent(id)}`;
    return (await this.#call({ method: 'GET', path, signer }, NetAccountResponseSchema)).account;
  }

  async createInvite(signer: Signer, requestId: string): Promise<NetInvite> {
    const reply = await this.#call({ method: 'POST', path: NET_INVITES_PATH, body: { requestId }, signer },
      NetInviteResponseSchema);
    return reply.invite;
  }

  async invites(signer: Signer): Promise<NetInvite[]> {
    return (await this.#call({ method: 'GET', path: NET_INVITES_PATH, signer }, NetInvitesResponseSchema)).invites;
  }

  async checkInvite(code: string): Promise<boolean> {
    const path = `${NET_INVITES_PATH}/${encodeURIComponent(code)}`;
    return (await this.#call({ method: 'GET', path, signer: null }, NetInviteCheckSchema)).valid;
  }

  async handleAvailability(handle: string): Promise<NetHandleCheck> {
    const path = `${NET_HANDLES_PATH}/${encodeURIComponent(handle)}`;
    return this.#call({ method: 'GET', path, signer: null }, NetHandleCheckSchema);
  }

  async postEnvelope(signer: Signer, envelope: Envelope): Promise<void> {
    await this.#call({ method: 'POST', path: NET_ENVELOPES_PATH, body: envelope, signer },
      PostEnvelopeResponseSchema);
  }

  async poll(signer: Signer, after: string, waitSeconds: number, signal?: AbortSignal): Promise<EnvelopesResponse> {
    const path = `${NET_ENVELOPES_PATH}?after=${encodeURIComponent(after)}&wait=${waitSeconds}`;
    return this.#call({ method: 'GET', path, signer, timeoutMs: waitSeconds * 1000 + POLL_MARGIN_MS,
      ...(signal === undefined ? {} : { signal }) }, EnvelopesResponseSchema);
  }

  async ack(signer: Signer, ids: readonly string[]): Promise<number> {
    return (await this.#call({ method: 'POST', path: NET_ACK_PATH, body: { ids }, signer }, AckResponseSchema)).acked;
  }

  async block(signer: Signer, accountId: string): Promise<void> {
    await this.#call({ method: 'POST', path: NET_BLOCKS_PATH, body: { accountId }, signer }, OkResponseSchema);
  }

  async unblock(signer: Signer, accountId: string): Promise<void> {
    const path = `${NET_BLOCKS_PATH}/${encodeURIComponent(accountId)}`;
    await this.#call({ method: 'DELETE', path, signer }, OkResponseSchema);
  }

  async taskStatus(signer: Signer, taskId: string, state: NetTaskStatus, counterpart: string): Promise<void> {
    const path = `${NET_TASKS_PATH}/${encodeURIComponent(taskId)}/status`;
    await this.#call({ method: 'POST', path, body: { state, with: counterpart }, signer }, OkResponseSchema);
  }

  async taskStatuses(signer: Signer, counterpart: string): Promise<NetTaskStatusRecord[]> {
    const path = `${NET_TASKS_PATH}?with=${encodeURIComponent(counterpart)}`;
    return (await this.#call({ method: 'GET', path, signer }, NetTaskStatusesResponseSchema)).statuses;
  }
}
