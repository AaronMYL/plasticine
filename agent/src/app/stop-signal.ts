import type { Readable } from 'node:stream';

export interface StopSources {
  process: Pick<NodeJS.Process, 'once'>;
  stdin?: Readable;
}

export function stopOnStdinEof(env: Record<string, string | undefined>): boolean {
  return env['PLASTICINE_STOP_ON_STDIN_EOF'] === '1';
}

export function stopSignal(sources: StopSources): Promise<string> {
  return new Promise((resolve) => {
    sources.process.once('SIGTERM', () => resolve('SIGTERM'));
    sources.process.once('SIGINT', () => resolve('SIGINT'));
    const stdin = sources.stdin;
    if (stdin !== undefined) {
      stdin.on('data', () => undefined);
      stdin.once('end', () => resolve('stdin_closed'));
      stdin.once('close', () => resolve('stdin_closed'));
      stdin.once('error', () => resolve('stdin_closed'));
      stdin.resume();
    }
  });
}
