// 第三级：服务器命令合成一件（他 11-05 定：cloud_ssh_run 和 server_command 合并）。不写 host 就在 Plasticine 自己的
// 服务器上跑（旧的 server_exec：应用账号、已有 sudo、输出存盘）；写了 host 就经 SSH 在名单上的那台主机跑（旧的
// cloud_ssh_run）。两边的执行逻辑原样复用旧工具；读长输出仍用 server_command_read。服务器是 Plasticine 自己的电脑
// （第 97 条），不加硬线。

import { Type } from 'typebox';
import type { AgentTool } from '@earendil-works/pi-agent-core';
import { SERVER_COMMAND_MAX_MS } from '../../shared/server-command.ts';
import type { Tool } from '../brain/index.ts';
import { adaptLegacyTool, type LegacyOptions } from './legacy.ts';
import { checkedArgs } from './tool-args.ts';
import type { KernelTool, LineScope } from './types.ts';

// 和旧 server_exec 一样长：一段脚本 6 万字以内。
const SCRIPT_MAX_CHARS = 60_000;

const ServerCommandParameters = Type.Object({
  script: Type.String({ minLength: 1, maxLength: SCRIPT_MAX_CHARS,
    description: 'A script: PowerShell on Windows, bash elsewhere' }),
  host: Type.Optional(Type.String({ pattern: '^[a-z0-9][a-z0-9_-]{0,31}$',
    description: 'Run on this allowlisted host over SSH instead of Plasticine\'s own server' })),
  cwd: Type.Optional(Type.String({ minLength: 1, maxLength: 4_096 })),
  timeoutMs: Type.Optional(Type.Integer({ minimum: 1, maximum: SERVER_COMMAND_MAX_MS })),
}, { additionalProperties: false });

export interface ServerToolParts {
  /** 旧的 server_exec（本机）。 */
  local: Tool;
  /** 旧的 cloud_ssh_run（名单上的主机）；没接 SSH 时是 undefined。 */
  remote: Tool | undefined;
}

function serverAgentTool(parts: ServerToolParts, scope: LineScope, options: LegacyOptions): AgentTool {
  const local = adaptLegacyTool(parts.local, { say: () => '' }, options).create(scope);
  const remote = parts.remote === undefined ? undefined
    : adaptLegacyTool(parts.remote, { say: () => '' }, options).create(scope);
  return {
    name: 'server_command',
    label: '服务器命令',
    description: 'Runs a script on Plasticine\'s own server as the application account (PowerShell on Windows, '
      + 'bash elsewhere; sudo -n when needed), or, with host, on a host from the SSH allowlist. '
      + 'Returns status, exit code and the start of stdout / stderr; use server_command_read for the rest. Check exitCode: finishing is not succeeding. Never print secrets.',
    parameters: ServerCommandParameters,
    async execute(toolCallId, raw, signal, onUpdate) {
      const args = checkedArgs(ServerCommandParameters, raw, 'server_command');
      if (args.host === undefined) {
        const { host: _host, ...rest } = args;
        return local.execute(toolCallId, rest, signal, onUpdate);
      }
      if (remote === undefined) {
        throw new Error('这台服务器还没接上 SSH 主机名单，host 用不了；不写 host 就在本机跑。');
      }
      return remote.execute(toolCallId, { host: args.host, command: args.script }, signal, onUpdate);
    },
  };
}

export function serverCommandTool(parts: ServerToolParts, options: LegacyOptions): KernelTool {
  return {
    name: 'server_command',
    say: (args) => (typeof args['host'] === 'string' ? `在 ${args['host']} 上跑命令` : '在服务器上跑命令'),
    hardLine: () => null,
    enabled: () => (options.enabled?.(parts.local.name) ?? true)
      || (parts.remote !== undefined && (options.enabled?.(parts.remote.name) ?? true)),
    create: (scope) => serverAgentTool(parts, scope, options),
  };
}
