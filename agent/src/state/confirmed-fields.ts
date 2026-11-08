// User-confirmed fields (约定生效、判断的 p 与现实结果、设备上限): 仓库硬规矩 and 《实施方案》第 5 节
// 第 4 条 say only a request carrying a device confirmation may write them, so model tools can never reach them.
// The ordinary write path calls `rejectConfirmedFields` before anything else; only `confirm` lets them through.

import { DeviceConfirmationSchema, type DeviceConfirmation } from '../../shared/state.ts';
import { checked } from './codec.ts';
import { StateError } from './errors.ts';

/** A user-confirmed field. `freeValues` are values an ordinary write may still set (约定「待议」). */
export interface ConfirmedRule {
  field: string;
  freeValues?: readonly unknown[];
}

export function rejectConfirmedFields(table: string, rules: readonly ConfirmedRule[], values: unknown): void {
  if (typeof values !== 'object' || values === null) {
    // Not an object at all: the schema check right after this reports it with a better message.
    return;
  }
  const entries = new Map<string, unknown>(Object.entries(values));
  for (const rule of rules) {
    if (!entries.has(rule.field)) {
      continue;
    }
    if (rule.freeValues !== undefined && rule.freeValues.includes(entries.get(rule.field))) {
      continue;
    }
    const message = `${table}.${rule.field} 是用户确认字段，只能经已配对设备的确认写入；模型和普通写入只能写提议字段`;
    throw new StateError('confirmation_required', message, { field: rule.field });
  }
}

export function requireConfirmation(confirmation: unknown): DeviceConfirmation {
  if (confirmation === undefined || confirmation === null) {
    throw new StateError('confirmation_required', '写用户确认字段必须带设备确认（设备 id 和确认时间）');
  }
  return checked(DeviceConfirmationSchema, confirmation, 'confirmation_required', '设备确认');
}
