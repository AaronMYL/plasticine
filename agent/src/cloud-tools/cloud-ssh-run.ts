import { Type } from 'typebox';
import { COMMAND_MAX_CHARS } from './ssh.ts';
import type { SshResult } from './transports.ts';
import { defineTool, type Tool } from '../tools/index.ts';

export interface SshRunner {
  run(host: string, command: string, signal: AbortSignal): Promise<SshResult>;
}

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
