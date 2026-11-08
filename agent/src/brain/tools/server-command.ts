import { ServerCommandReadSchema, ServerCommandRequestSchema, SERVER_COMMAND_MAX_MS,
  type ServerCommandRecord } from '../../../shared/server-command.ts';
import type { ServerCommands } from '../../cloud-tools/index.ts';
import { ToolUncertain } from './failure.ts';
import { defineTool, type Tool } from './registry.ts';

function summary(row: ServerCommandRecord) {
  const { script, error, ...record } = row;
  return { ...record, scriptPreview: Array.from(script).slice(0, 500).join(''), scriptChars: Array.from(script).length,
    error: error?.slice(0, 500) ?? null, succeeded: row.status === 'completed' && row.exitCode === 0 };
}

export function createServerCommandTools(commands: ServerCommands): Tool[] {
  return [defineTool({ name: 'server_exec', label: '服务器命令',
    description: 'Runs a script on Plasticine\'s own server as the application account (PowerShell on Windows, '
      + 'bash elsewhere), with its existing permissions (sudo -n when elevated execution is needed). '
      + 'The call\'s action identity prevents duplicate execution. Inspect status and exitCode: command completion '
      + 'does not mean the work succeeded. Cancellation/timeouts stop the process group. Full output is persisted; '
      + 'use server_command_read to inspect it or verify a previously interrupted action before doing anything again.',
    parameters: ServerCommandRequestSchema, replay: 'once', effect: 'external', permission: 'auto',
    roles: ['conversation', 'worker'], timeoutMs: SERVER_COMMAND_MAX_MS + 5_000,
    async execute(args, context) {
      if (context.actionId === null) {
        throw new Error('服务器执行缺少动作标识，未发出命令。');
      }
      const row = await commands.execute(args, { actionId: context.actionId, runId: context.runId, taskId: null },
        context.signal);
      const brief = summary(row);
      if (row.status === 'unknown') {
        throw new ToolUncertain(JSON.stringify({ ...brief,
          note: '结果待核实，没有重新执行；用 server_command_read 读该命令，再检查实际文件、进程或服务状态。' }));
      }
      const stdout = commands.read(row.id, 'stdout', 0, 2_000);
      const stderr = commands.read(row.id, 'stderr', 0, 1_000);
      return JSON.stringify({ ...brief, reused: row.reused,
        stdout: { text: stdout.text, nextOffset: stdout.nextOffset, totalChars: stdout.totalChars },
        stderr: { text: stderr.text, nextOffset: stderr.nextOffset, totalChars: stderr.totalChars },
        outputReader: 'server_command_read' });
    },
  }), defineTool({ name: 'server_command_read', label: '服务器命令 · 核实与读输出',
    description: 'Reads durable execution metadata and complete paged stdout/stderr/script for server_exec. '
      + 'Without commandId, lists recent commands. Offsets count Unicode characters. '
      + 'An unknown action must be checked against its output and actual effects; do not rerun it merely to find out.',
    parameters: ServerCommandReadSchema, replay: 'safe', effect: 'read', permission: 'auto', parallel: true,
    roles: ['conversation', 'worker', 'verifier', 'diagnosis'], timeoutMs: 5_000, maxResultChars: 12_000,
    async execute(args) {
      if (args.commandId === undefined) {
        return JSON.stringify({ commands: commands.list(args.taskId).slice(0, 10).map(summary) });
      }
      const page = commands.read(args.commandId, args.stream, args.offset, args.limit);
      return JSON.stringify({ ...page, command: summary(page.command) });
    },
  })];
}
