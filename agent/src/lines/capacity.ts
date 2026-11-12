// 同时做几件事（11-12 全量优化第 2 条，Aaron 定：「设置里可调，默认自动」）。
// 设置存在 kernel_settings 的 background_limit：'auto' 或 1–8。自动 = 按这台机器现在的样子算：核数定上限，
// 机器正忙（负载高过核数）或内存快用完时少开新的。算出来的是「还能不能再开一条」的上限，已经在跑的不会被掐掉。

import { availableParallelism, freemem, loadavg, totalmem } from 'node:os';
import {
  WORK_LIMIT_AUTO,
  WORK_LIMIT_MAX,
  type WorkLimitSetting,
} from '../../shared/api/account.ts';

export const BACKGROUND_LIMIT_KEY = 'background_limit';

/** 这台机器现在的样子。 */
export interface MachineLoad {
  cores: number;
  /** 最近一分钟的负载；Windows 上没有这个数，是 0。 */
  load1: number;
  /** 还能用的内存占比（0–1）。 */
  freeRatio: number;
}

export function machineLoad(): MachineLoad {
  const total = totalmem();
  return { cores: availableParallelism(), load1: loadavg()[0] ?? 0, freeRatio: total > 0 ? freemem() / total : 1 };
}

const AUTO_MIN = 2;
const AUTO_MAX = 6;
/** 内存只剩这么点：只留一条在跑。 */
const MEMORY_TIGHT = 0.08;
/** 内存不宽裕：减半。 */
const MEMORY_LOW = 0.15;

/** 自动：核数 + 1（2–6）；负载高过核数或内存不宽裕减半，高过一倍半或内存快没了只留一条。 */
export function autoLimit(machine: MachineLoad): number {
  const cores = Math.max(1, Math.floor(machine.cores));
  const base = Math.min(AUTO_MAX, Math.max(AUTO_MIN, cores + 1));
  if (machine.load1 > cores * 1.5 || machine.freeRatio < MEMORY_TIGHT) {
    return 1;
  }
  if (machine.load1 > cores || machine.freeRatio < MEMORY_LOW) {
    return Math.max(1, Math.floor(base / 2));
  }
  return base;
}

/** 读设置；没存过或存的不认识就是自动。 */
export function readWorkLimit(state: { kernelSettings: { get(key: string): unknown } }): WorkLimitSetting {
  const stored = state.kernelSettings.get(BACKGROUND_LIMIT_KEY);
  return typeof stored === 'number' && Number.isInteger(stored) && stored >= 1 && stored <= WORK_LIMIT_MAX
    ? stored : WORK_LIMIT_AUTO;
}

export function effectiveLimit(setting: WorkLimitSetting, machine: MachineLoad): number {
  return setting === WORK_LIMIT_AUTO ? autoLimit(machine) : setting;
}
