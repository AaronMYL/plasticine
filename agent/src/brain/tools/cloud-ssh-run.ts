// cloud_ssh_run（《实施方案》第 5 节沿用的云端工具）：在名单上的一台主机上跑一条命令。replay = once、effect = external：
// 同一调用重放用上次的结果，不跑第二次；开发期干跑只记不跑。第 97 条（10-29）：服务器是 Plasticine 的电脑，不再逐次
// 批准（原来的批准入口从没接上，你点了批准也执行不了）。主机只能说名单上的名字，凭据在服务器上、模型看不到。
// 工具组「云端命令」默认开启；用户已明确关闭的存量设置仍生效。

import { Type } from 'typebox';
import { COMMAND_MAX_CHARS, type SshResult } from '../../cloud-tools/index.ts';
import { defineTool, type Tool } from './registry.ts';

export interface SshRunner {
  run(host: string, command: string, signal: AbortSignal): Promise<SshResult>;
}

// 和 cloud-tools/ssh.ts 的等待一样长，再留 5 秒收尾。
const SSH_TOOL_TIMEOUT_MS = 125_000;

export const CloudSshRunParameters = Type.Object(
  {
    host: Type.String({ pattern: '^[a-z0-9][a-z0-9_-]{0,31}$', description: 'Name of a host on the allowlist' }),
    command: Type.String({ minLength: 1, maxLength: COMMAND_MAX_CHARS, description: 'One shell command' }),
  },
  { additionalProperties: false },
);

export function createCloudSshRunTool(runner: SshRunner): Tool {
  return defineTool({
    name: 'cloud_ssh_run',
    label: '云端命令',
    description:
      'Runs one shell command on a host from the allowlist (by its name) and returns the exit code and output. ' +
      'Never ask for or print passwords or keys.',
    replay: 'once',
    effect: 'external',
    permission: 'auto',
    roles: ['conversation', 'worker'],
    timeoutMs: SSH_TOOL_TIMEOUT_MS,
    parameters: CloudSshRunParameters,
    async execute(args, context) {
      const result = await runner.run(args.host, args.command, context.signal);
      return JSON.stringify(result);
    },
  });
}
