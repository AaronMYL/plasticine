// 通用连接（11-16）：设置里连的服务（state 的 connections）加上它的令牌（凭据目录）和 MCP 客户端。加、改了地址或令牌就
// 测一次（拿工具清单）；Plasticine 用的时候按名字找、只用开着的。令牌只进不出。

import type { ConnectionView } from '../../shared/api/connections.ts';
import type { ConnectionRow, StateService } from '../state/index.ts';
import type { CredentialFiles } from './credentials.ts';
import { CloudToolError } from './errors.ts';
import { McpClient, type McpCallResult } from './mcp-client.ts';
import { checkPublicHttpsUrl } from './urls.ts';

export interface ConnectionsOptions {
  state: Pick<StateService, 'connections'>;
  credentials: CredentialFiles;
  fetch?: typeof globalThis.fetch;
  /** 测试连本机的假服务。 */
  allowLocal?: boolean;
}

function credentialName(id: string): string {
  return `connection-${id.replace(/^conn_/, '').replace(/[^a-z0-9]/g, '').slice(0, 40)}`;
}

export function connectionView(row: ConnectionRow): ConnectionView {
  return { id: row.id, name: row.name, url: row.url, hasToken: row.credential !== null, enabled: row.enabled,
    tools: row.tools, status: row.status, error: row.error, checkedAt: row.checkedAt };
}

export class Connections {
  readonly #options: ConnectionsOptions;

  constructor(options: ConnectionsOptions) {
    this.#options = options;
  }

  views(): ConnectionView[] {
    return this.#options.state.connections.list().map(connectionView);
  }

  #client(row: ConnectionRow): McpClient {
    const token = row.credential === null ? null : this.#options.credentials.read(row.credential).toString('utf8');
    return new McpClient(row.url, token, this.#options.fetch, this.#options.allowLocal === true);
  }

  /** 只认公网 https：不许连本机和内网。 */
  #checkUrl(url: string): void {
    if (this.#options.allowLocal !== true) checkPublicHttpsUrl(url, 'url');
  }

  #setToken(id: string, token: string | null | undefined): void {
    if (token === undefined) return;
    const name = credentialName(id);
    this.#options.credentials.write(name, token === null ? null : token.trim());
    this.#options.state.connections.update(id, { credential: token === null ? null : name });
  }

  async create(input: { name: string; url: string; token?: string }, signal: AbortSignal): Promise<ConnectionView> {
    if (this.#options.state.connections.byName(input.name) !== undefined) {
      throw new CloudToolError('invalid_input', `已经有一个叫「${input.name}」的连接了：换个名字。`, 'name');
    }
    this.#checkUrl(input.url);
    const row = this.#options.state.connections.create({ name: input.name.trim(), url: input.url.trim() });
    this.#setToken(row.id, input.token);
    return this.test(row.id, signal);
  }

  async update(id: string, patch: { name?: string; url?: string; token?: string | null; enabled?: boolean },
    signal: AbortSignal): Promise<ConnectionView> {
    const { connections } = this.#options.state;
    const before = connections.require(id);
    const same = patch.name === undefined ? undefined : connections.byName(patch.name);
    if (same !== undefined && same.id !== id) {
      throw new CloudToolError('invalid_input', `已经有一个叫「${same.name}」的连接了：换个名字。`, 'name');
    }
    if (patch.url !== undefined) this.#checkUrl(patch.url);
    connections.update(id, { ...(patch.name === undefined ? {} : { name: patch.name.trim() }),
      ...(patch.url === undefined ? {} : { url: patch.url.trim() }),
      ...(patch.enabled === undefined ? {} : { enabled: patch.enabled }) });
    this.#setToken(id, patch.token);
    const retest = (patch.url !== undefined && patch.url !== before.url) || patch.token !== undefined;
    return retest ? this.test(id, signal) : connectionView(connections.require(id));
  }

  /** 测一次：拿工具清单；没连上把原因记下。 */
  async test(id: string, signal: AbortSignal): Promise<ConnectionView> {
    const { connections } = this.#options.state;
    const row = connections.require(id);
    try {
      const tools = await this.#client(row).listTools(signal);
      return connectionView(connections.checked(id, { tools: tools.map((tool) => ({ name: tool.name,
        description: tool.description, readOnly: tool.readOnly })) }));
    } catch (cause) {
      if (!(cause instanceof CloudToolError)) throw cause;
      return connectionView(connections.checked(id, { error: cause.message }));
    }
  }

  remove(id: string): void {
    const row = this.#options.state.connections.require(id);
    if (row.credential !== null) this.#options.credentials.write(row.credential, null);
    this.#options.state.connections.remove(id);
  }

  /** 开着的连接里的一个工具；没有就说清楚有哪些。 */
  find(name: string, tool: string): { connection: ConnectionRow; readOnly: boolean } {
    const connection = this.#options.state.connections.byName(name);
    if (connection === undefined || !connection.enabled) {
      const names = this.#options.state.connections.list().filter((row) => row.enabled).map((row) => row.name);
      throw new CloudToolError('invalid_input', `没有开着的连接「${name}」；开着的：${names.join('、') || '没有'}。`);
    }
    const found = connection.tools.find((item) => item.name === tool);
    if (found === undefined) {
      throw new CloudToolError('invalid_input', `「${name}」没有工具「${tool}」：先用 connection_tools 看有哪些。`);
    }
    return { connection, readOnly: found.readOnly };
  }

  async call(name: string, tool: string, args: Record<string, unknown>, signal: AbortSignal): Promise<McpCallResult> {
    const { connection } = this.find(name, tool);
    return this.#client(connection).callTool(tool, args, signal);
  }
}
