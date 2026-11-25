import { availableParallelism, freemem, loadavg, totalmem } from 'node:os';
import {
  WORK_LIMIT_AUTO,
  WORK_LIMIT_MAX,
  type WorkLimitSetting,
} from '../../shared/api/account.ts';

export const BACKGROUND_LIMIT_KEY = 'background_limit';

export interface MachineLoad {
  cores: number;
  load1: number;
  freeRatio: number;
}

export function machineLoad(): MachineLoad {
  const total = totalmem();
  return { cores: availableParallelism(), load1: loadavg()[0] ?? 0, freeRatio: total > 0 ? freemem() / total : 1 };
}

const AUTO_MIN = 2;
const AUTO_MAX = 6;
const MEMORY_TIGHT = 0.08;
const MEMORY_LOW = 0.15;

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

export function readWorkLimit(state: { kernelSettings: { get(key: string): unknown } }): WorkLimitSetting {
  const stored = state.kernelSettings.get(BACKGROUND_LIMIT_KEY);
  return typeof stored === 'number' && Number.isInteger(stored) && stored >= 1 && stored <= WORK_LIMIT_MAX
    ? stored : WORK_LIMIT_AUTO;
}

export function effectiveLimit(setting: WorkLimitSetting, machine: MachineLoad): number {
  return setting === WORK_LIMIT_AUTO ? autoLimit(machine) : setting;
}
