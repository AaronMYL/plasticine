// server_health（11-16）：AI 查服务卡没卡、卡在哪，不用自己拼 journalctl 和 perf。给最近一段时间按路由汇总的请求
// （次数、出错、p95、最慢、总耗时）、出错的请求（路由、错误、位置）、慢查询、事件循环延迟，加上机器负载、内存和占 CPU
// 最多的几个进程（Linux / Mac 上用 ps）。只读，不用问。

import { execFile } from 'node:child_process';
import { cpus, freemem, loadavg, totalmem } from 'node:os';
import { Type } from 'typebox';
import { defineTool, type Tool } from '../tools/index.ts';
import type { Diagnostics } from './diagnostics.ts';

const DEFAULT_MINUTES = 30;
const PS_TIMEOUT_MS = 3_000;
const TOP_PROCESSES = 8;

function topProcesses(): Promise<string[]> {
  if (process.platform === 'win32') {
    return Promise.resolve([]);
  }
  return new Promise((resolve) => {
    // Mac 的 ps 用 -r 按 CPU 排；Linux 的 -r 是「只看在跑的」，要用 --sort。
    const args = process.platform === 'darwin' ? ['-Ao', 'pid,pcpu,pmem,etime,comm', '-r']
      : ['-eo', 'pid,pcpu,pmem,etime,comm', '--sort=-pcpu'];
    execFile('ps', args, { timeout: PS_TIMEOUT_MS }, (error, stdout) => {
      if (error !== null) {
        resolve([`ps 没跑成：${error.message}`]);
        return;
      }
      resolve(stdout.trim().split('\n').slice(0, TOP_PROCESSES + 1).map((line) => line.trim()));
    });
  });
}

export function createServerHealthTool(diagnostics: Diagnostics): Tool {
  return defineTool({ name: 'server_health', label: '服务体检',
    description: '看 Plasticine 服务这会儿健不健康：最近一段时间按路由汇总的请求（次数、出错、p95、最慢、总耗时，'
      + '总耗时排前面的就是占住服务的）、出错的请求（路由、错误原文、代码位置）、慢查询（超过 200 毫秒的语句开头）、'
      + '每分钟的事件循环延迟（p99 高说明服务被同步工作占住）、机器负载、内存和占 CPU 最多的进程。只读。',
    parameters: Type.Object({ minutes: Type.Optional(Type.Integer({ minimum: 1, maximum: 240,
      description: '看最近多少分钟（默认 30）' })) }, { additionalProperties: false }),
    replay: 'safe', effect: 'read', permission: 'auto', roles: ['conversation', 'worker'], timeoutMs: 10_000,
    maxResultChars: 40_000,
    async execute(args) {
      const minutes = args.minutes ?? DEFAULT_MINUTES;
      const memory = process.memoryUsage();
      return JSON.stringify({
        minutes,
        service: { uptimeMinutes: Math.round(process.uptime() / 60), rssMb: Math.round(memory.rss / 1e6),
          heapMb: Math.round(memory.heapUsed / 1e6) },
        machine: { cores: cpus().length, load: loadavg().map((value) => Math.round(value * 100) / 100),
          freeMemoryMb: Math.round(freemem() / 1e6), totalMemoryMb: Math.round(totalmem() / 1e6),
          topProcesses: await topProcesses() },
        ...diagnostics.snapshot(minutes),
      });
    },
  });
}
