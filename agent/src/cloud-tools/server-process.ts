import { spawn } from 'node:child_process';
import { closeSync, openSync, writeSync } from 'node:fs';
import { join } from 'node:path';
import type { ServerCommandRecord, ServerCommandStatus } from '../../shared/server-command.ts';
import { killProcessTree, shellFor } from './server-shell.ts';

export const SERVER_OUTPUT_MAX_BYTES = 16 * 1024 * 1024;
export interface ServerProcessResult {
  status: ServerCommandStatus;
  exitCode: number | null;
  signal: string | null;
  stdoutBytes: number;
  stderrBytes: number;
  error: string | null;
}

/**
 * A foreground shell owns one process group (one process tree on Windows, server-shell.ts). A completed shell must not
 * leave forgotten background children.
 */
export function runServerProcess(command: ServerCommandRecord, directory: string, signal: AbortSignal,
  onStart: (pid: number) => void): Promise<ServerProcessResult> {
  return new Promise((resolve, reject) => {
    const stdout = openSync(join(directory, 'stdout'), 'w', 0o600);
    const stderr = openSync(join(directory, 'stderr'), 'w', 0o600);
    const shell = shellFor(command.script, directory);
    const child = spawn(shell.command, shell.args, {
      cwd: command.cwd, detached: shell.detached, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
    });
    let stopped: ServerCommandStatus | null = null;
    let failure: Error | null = null;
    let outBytes = 0;
    let errBytes = 0;
    let startFailed = false;
    const kill = (): void => {
      if (child.pid === undefined) { return; }
      try { killProcessTree(child.pid); }
      catch (error) { failure ??= error as Error; }
    };
    const stop = (status: ServerCommandStatus): void => { stopped ??= status; kill(); };
    const onAbort = (): void => stop('cancelled');
    const timer = setTimeout(() => stop('timed_out'), command.timeoutMs);
    signal.addEventListener('abort', onAbort, { once: true });
    child.on('spawn', () => {
      try {
        if (child.pid !== undefined) { onStart(child.pid); }
        if (signal.aborted) { onAbort(); }
      } catch (error) { failure = error as Error; kill(); }
    });
    const capture = (fd: number, chunk: Buffer, stream: 'stdout' | 'stderr'): void => {
      try {
        const room = Math.max(0, SERVER_OUTPUT_MAX_BYTES - outBytes - errBytes);
        const data = chunk.subarray(0, room);
        let offset = 0;
        while (offset < data.length) { offset += writeSync(fd, data, offset); }
        if (stream === 'stdout') { outBytes += data.length; } else { errBytes += data.length; }
        if (data.length < chunk.length) { stop('output_limit'); }
      } catch (error) { failure = error as Error; kill(); }
    };
    child.stdout.on('data', (data: Buffer) => capture(stdout, data, 'stdout'));
    child.stderr.on('data', (data: Buffer) => capture(stderr, data, 'stderr'));
    child.on('error', (error) => { startFailed = true; failure = error; });
    // exit arrives before pipe close; kill inherited children so they cannot keep the pipes or effects alive.
    child.on('exit', kill);
    child.on('close', (exitCode, exitSignal) => {
      clearTimeout(timer);
      signal.removeEventListener('abort', onAbort);
      closeSync(stdout);
      closeSync(stderr);
      if (failure !== null && !startFailed) { reject(failure); return; }
      resolve({ status: startFailed ? 'start_failed' : stopped ?? 'completed', exitCode, signal: exitSignal,
        stdoutBytes: outBytes, stderrBytes: errBytes, error: failure?.message ?? null });
    });
    if (signal.aborted) { onAbort(); }
  });
}
