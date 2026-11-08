// 服务什么时候该收尾：SIGTERM / SIGINT（systemd），以及安装包的看护进程关掉 stdin（Mac App、Windows 托盘）。
// Windows 没有 SIGTERM 可发，看护进程退出（哪怕是崩了）时 stdin 一定会关，服务据此收尾，不留孤儿进程占着端口。
// 只在 PLASTICINE_STOP_ON_STDIN_EOF=1 时听 stdin：systemd 下 stdin 是 /dev/null，一开就是 EOF。

import type { Readable } from 'node:stream';

export interface StopSources {
  /** 进程本身（测试传一个 EventEmitter）。 */
  process: Pick<NodeJS.Process, 'once'>;
  /** 看护进程交过来的 stdin；不听就不传。 */
  stdin?: Readable;
}

export function stopOnStdinEof(env: Record<string, string | undefined>): boolean {
  return env['PLASTICINE_STOP_ON_STDIN_EOF'] === '1';
}

/** 第一个到的收尾理由：'SIGTERM'、'SIGINT' 或 'stdin_closed'。 */
export function stopSignal(sources: StopSources): Promise<string> {
  return new Promise((resolve) => {
    sources.process.once('SIGTERM', () => resolve('SIGTERM'));
    sources.process.once('SIGINT', () => resolve('SIGINT'));
    const stdin = sources.stdin;
    if (stdin !== undefined) {
      // 读走看护进程写进来的任何东西（目前不写），只等它关。
      stdin.on('data', () => undefined);
      stdin.once('end', () => resolve('stdin_closed'));
      stdin.once('close', () => resolve('stdin_closed'));
      stdin.once('error', () => resolve('stdin_closed'));
      stdin.resume();
    }
  });
}
