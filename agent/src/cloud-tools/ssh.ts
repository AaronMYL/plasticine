// 云端命令（cloud_ssh_run，1ca0391 cloud-ssh.ts 的行为）：只连名单上的主机。名单在状态目录 cloud-tools/ssh-hosts.json，
// 每台写名字、主机名、端口、用户名和凭据名（凭据本身在 credentials/，见 credentials.ts）；工具和模型只说名字，说不出
// 名单外的主机。主机名只收普通的域名或公网地址，不带用户名密码；命令不许带 NUL、有长度上限。输出截短、不进日志。

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Type, type Static } from 'typebox';
import { Value } from 'typebox/value';
import { CREDENTIAL_NAME_PATTERN, type CredentialFiles } from './credentials.ts';
import { CloudToolError } from './errors.ts';
import type { SshResult, SshTarget, SshTransport } from './transports.ts';
import { isPrivateHost } from './urls.ts';

export const SSH_HOSTS_FILE = join('cloud-tools', 'ssh-hosts.json');
export const COMMAND_MAX_CHARS = 4_000;
// 一条命令最多等 2 分钟（1ca0391 cloud-ssh.ts 默认 120 秒）。
export const SSH_TIMEOUT_MS = 120_000;
// 回给模型的输出各截到这么长（工具结果一页 10 000 字，两段加起来不超）。
export const OUTPUT_MAX_CHARS = 4_000;
const DEFAULT_SSH_PORT = 22;
const LABEL = '[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?';
const HOST_NAME_PATTERN = new RegExp(`^(?=.{1,253}$)${LABEL}(?:\\.${LABEL})*$`, 'i');

const HostEntrySchema = Type.Object(
  {
    name: Type.String({ pattern: '^[a-z0-9][a-z0-9_-]{0,31}$' }),
    host: Type.String({ minLength: 1, maxLength: 253 }),
    port: Type.Optional(Type.Integer({ minimum: 1, maximum: 65_535 })),
    user: Type.String({ pattern: '^[a-z_][a-z0-9_-]{0,31}$' }),
    credential: Type.String({ minLength: 1 }),
  },
  { additionalProperties: false },
);
const HostsFileSchema = Type.Object({ hosts: Type.Array(HostEntrySchema, { maxItems: 50 }) }, {
  additionalProperties: false,
});
type HostEntry = Static<typeof HostEntrySchema>;

function checkEntry(entry: HostEntry): SshTarget {
  if (!HOST_NAME_PATTERN.test(entry.host) || entry.host.includes('@')) {
    throw new CloudToolError('invalid_input', `主机「${entry.name}」的主机名不合格式。`, 'host');
  }
  if (!CREDENTIAL_NAME_PATTERN.test(entry.credential)) {
    throw new CloudToolError('invalid_input', `主机「${entry.name}」的凭据名不合格式。`, 'credential');
  }
  if (isPrivateHost(entry.host) && entry.host !== 'localhost') {
    // 本机经 localhost 以服务账号做事是旧版就有的（10-26 第 10 条）；其余内网地址不连。
    throw new CloudToolError('invalid_input', `主机「${entry.name}」是内网地址，不在可连的范围。`, 'host');
  }
  return { ...entry, port: entry.port ?? DEFAULT_SSH_PORT };
}

/** The allowlist, read from the state directory each time (the user edits the file; no restart needed). */
export function readSshHosts(stateDirectory: string): SshTarget[] {
  const path = join(stateDirectory, SSH_HOSTS_FILE);
  if (!existsSync(path)) {
    return [];
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new CloudToolError('invalid_input', `${SSH_HOSTS_FILE} 不是合法的 JSON（${reason}）。`);
  }
  if (!Value.Check(HostsFileSchema, parsed)) {
    throw new CloudToolError('invalid_input', `${SSH_HOSTS_FILE} 的格式不对，名单没有用。`);
  }
  return parsed.hosts.map(checkEntry);
}

function clipOutput(text: string): string {
  const chars = Array.from(text);
  if (chars.length <= OUTPUT_MAX_CHARS) {
    return text;
  }
  return `${chars.slice(0, OUTPUT_MAX_CHARS).join('')}…（截掉了 ${chars.length - OUTPUT_MAX_CHARS} 字）`;
}

export interface CloudSshDeps {
  stateDirectory: string;
  transport: SshTransport;
  credentials: CredentialFiles;
  /** A stub transport cannot become ready merely because a credential file exists. */
  connected?: boolean;
}

export class CloudSsh {
  readonly #deps: CloudSshDeps;

  constructor(deps: CloudSshDeps) {
    this.#deps = deps;
  }

  /** Names on the list, with whether their credential is in place (never the credential itself). */
  hosts(): { name: string; host: string; ready: boolean }[] {
    return readSshHosts(this.#deps.stateDirectory).map((target) => ({
      name: target.name,
      host: target.host,
      ready: this.#deps.connected !== false && this.#deps.credentials.status(target.credential) === 'ready',
    }));
  }

  async run(hostName: string, command: string, signal: AbortSignal): Promise<SshResult> {
    if (command.trim() === '' || command.length > COMMAND_MAX_CHARS || command.includes('\0')) {
      throw new CloudToolError('invalid_input', `命令要是 1–${COMMAND_MAX_CHARS} 个字符、不带 NUL。`, 'command');
    }
    const target = readSshHosts(this.#deps.stateDirectory).find((entry) => entry.name === hostName);
    if (target === undefined) {
      throw new CloudToolError('invalid_input', `「${hostName}」不在可连的主机名单上。`, 'host');
    }
    const status = this.#deps.credentials.status(target.credential);
    if (status !== 'ready') {
      const missing = status === 'missing';
      const reason = missing ? '还没有放凭据' : '凭据文件的权限不是 600';
      throw new CloudToolError(missing ? 'not_configured' : 'credential_unsafe', `「${hostName}」${reason}。`);
    }
    const result = await this.#deps.transport.run(target, command, { signal, timeoutMs: SSH_TIMEOUT_MS });
    return { exitCode: result.exitCode, stdout: clipOutput(result.stdout), stderr: clipOutput(result.stderr) };
  }
}
