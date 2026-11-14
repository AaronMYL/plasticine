// 设备节点和本体之间的 HTTP（协议照 mac/README.md「节点协议和动作」和 agent/shared/api/node-channel.ts）：配对、hello、
// 长轮询领动作、交回执，以及信息流要这台电脑做的两样（X 时间线、抖音取数）。节点 Bearer 鉴权，不跟随重定向；
// 「这台电脑」模式下本体是 http://127.0.0.1:8790，远程只认 https。fetch 由壳给（Electron 的 net.fetch，走系统代理）。

import { Value } from 'typebox/value';
import { DOUYIN_NODE_PATH, DouyinJobsResponseSchema, FEED_X_PATH, FEED_XHS_PATH, NODE_HELLO_PATH, NODE_NEXT_ACTION_PATH,
  NODE_PAIR_PATH, NODE_POLL_MAX_SECONDS, NODE_PROTOCOL_VERSION, NODES_PATH, NodeHelloResponseSchema,
  NodeNextActionResponseSchema, NodePairResponseSchema, XTimelineDueSchema, type DouyinJob,
  type DouyinReport, type NodeActionResultRequest, type NodeHelloResponse, type NodePairResponse, type NodeWireAction,
  type XTimelineDue, type XTimelineReport, XhsDueSchema, type XhsDue, type XhsReport } from
  '../../../agent/shared/api/index.ts';
import type { Static, TSchema } from 'typebox';
import type { DeviceActionKind } from '../../../agent/shared/state.ts';

/** 一般请求的时限；长轮询另加等待时间。 */
const REQUEST_TIMEOUT_MS = 30_000;

export class NodeUnauthorized extends Error {}
export class NodeHttpError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export interface NodeIdentity {
  name: string;
  platform: 'macos' | 'windows' | 'linux';
  appVersion: string;
}

export class NodeApi {
  private readonly server: URL;
  private readonly fetcher: typeof fetch;

  constructor(server: string, fetcher: typeof fetch) {
    const url = new URL(server);
    const loopback = url.protocol === 'http:' && (url.hostname === '127.0.0.1' || url.hostname === 'localhost');
    if (url.protocol !== 'https:' && !loopback) {
      throw new Error('设备服务只连 https 的本体，或这台电脑上的本体。');
    }
    this.server = new URL('/', url);
    this.fetcher = fetcher;
  }

  get origin(): string {
    return this.server.href;
  }

  async pair(input: { requestId: string; code: string; identity: NodeIdentity;
    capabilities: readonly DeviceActionKind[] }): Promise<NodePairResponse> {
    const body = { requestId: input.requestId, code: input.code.trim(), name: input.identity.name,
      platform: input.identity.platform, appVersion: input.identity.appVersion,
      protocolVersion: NODE_PROTOCOL_VERSION, capabilities: [...input.capabilities] };
    return this.json(NODE_PAIR_PATH, null, { method: 'POST', body }, NodePairResponseSchema);
  }

  async hello(credential: string, input: { appVersion: string; capabilities: readonly DeviceActionKind[];
    idleSeconds: number | null }): Promise<NodeHelloResponse> {
    const body = { appVersion: input.appVersion, protocolVersion: NODE_PROTOCOL_VERSION,
      capabilities: [...input.capabilities],
      ...(input.idleSeconds === null ? {} : { idleSeconds: input.idleSeconds }) };
    return this.json(NODE_HELLO_PATH, credential, { method: 'POST', body }, NodeHelloResponseSchema);
  }

  /** 长轮询：没有活回 null（204）。 */
  async next(credential: string, signal: AbortSignal): Promise<NodeWireAction | null> {
    const path = `${NODE_NEXT_ACTION_PATH}?wait=${NODE_POLL_MAX_SECONDS}`;
    const response = await this.request(path, credential, { method: 'GET' },
      REQUEST_TIMEOUT_MS + NODE_POLL_MAX_SECONDS * 1000, signal);
    if (response.status === 204) {
      return null;
    }
    const body: unknown = await response.json();
    if (!Value.Check(NodeNextActionResponseSchema, body)) {
      throw new NodeHttpError(response.status, '本体发来的动作形状不对。');
    }
    return body.action;
  }

  async result(credential: string, actionId: string, result: NodeActionResultRequest): Promise<void> {
    await this.request(`${NODES_PATH}/actions/${encodeURIComponent(actionId)}/result`, credential,
      { method: 'POST', body: result }, REQUEST_TIMEOUT_MS);
  }

  async xDue(credential: string): Promise<XTimelineDue> {
    return this.json(FEED_X_PATH, credential, { method: 'GET' }, XTimelineDueSchema);
  }

  async xReport(credential: string, report: XTimelineReport): Promise<void> {
    await this.request(FEED_X_PATH, credential, { method: 'POST', body: report }, REQUEST_TIMEOUT_MS);
  }

  async xhsDue(credential: string): Promise<XhsDue> {
    return this.json(FEED_XHS_PATH, credential, { method: 'GET' }, XhsDueSchema);
  }

  async xhsReport(credential: string, report: XhsReport): Promise<void> {
    await this.request(FEED_XHS_PATH, credential, { method: 'POST', body: report }, REQUEST_TIMEOUT_MS);
  }

  async douyinJobs(credential: string): Promise<DouyinJob[]> {
    return (await this.json(DOUYIN_NODE_PATH, credential, { method: 'GET' }, DouyinJobsResponseSchema)).jobs;
  }

  async douyinReport(credential: string, report: DouyinReport): Promise<void> {
    await this.request(DOUYIN_NODE_PATH, credential, { method: 'POST', body: report }, REQUEST_TIMEOUT_MS);
  }

  private async json<S extends TSchema>(path: string, credential: string | null,
    init: { method: string; body?: unknown }, schema: S): Promise<Static<S>> {
    const response = await this.request(path, credential, init, REQUEST_TIMEOUT_MS);
    const body: unknown = await response.json();
    if (!Value.Check(schema, body)) {
      throw new NodeHttpError(response.status, `本体对 ${path} 的回答形状不对。`);
    }
    return body;
  }

  private async request(path: string, credential: string | null, init: { method: string; body?: unknown },
    timeoutMs: number, signal?: AbortSignal): Promise<Response> {
    const headers: Record<string, string> = { accept: 'application/json' };
    if (credential !== null) {
      headers.authorization = `Bearer ${credential}`;
    }
    if (init.body !== undefined) {
      headers['content-type'] = 'application/json';
    }
    const timeout = AbortSignal.timeout(timeoutMs);
    const response = await this.fetcher(new URL(path, this.server), {
      method: init.method, headers, redirect: 'manual',
      signal: signal === undefined ? timeout : AbortSignal.any([timeout, signal]),
      ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
    });
    if (response.status === 401) {
      throw new NodeUnauthorized('本体不认这台电脑的配对了，请重新配对。');
    }
    if (response.status >= 300) {
      const text = await response.text();
      throw new NodeHttpError(response.status, `本体回了 ${response.status}${text === '' ? '' : `：${text.slice(0, 200)}`}`);
    }
    return response;
  }
}
