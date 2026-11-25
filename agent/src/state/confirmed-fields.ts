import { DeviceConfirmationSchema, type DeviceConfirmation } from '../../shared/state.ts';
import { checked } from './codec.ts';
import { StateError } from './errors.ts';

export interface ConfirmedRule {
  field: string;
  freeValues?: readonly unknown[];
}

export function rejectConfirmedFields(table: string, rules: readonly ConfirmedRule[], values: unknown): void {
  if (typeof values !== 'object' || values === null) {
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
