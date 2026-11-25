import { DEVICE_PER_HOUR_MAX, type DeviceLimits } from '../../shared/state.ts';

export const DEFAULT_DEVICE_LIMITS: DeviceLimits = {
  roots: [],
  apps: [],
  sites: [],
  unattendedInput: true,
  classes: {
    read: { mode: 'allow', perHour: DEVICE_PER_HOUR_MAX },
    write: { mode: 'allow', perHour: DEVICE_PER_HOUR_MAX },
    delete: { mode: 'confirm_each', perHour: DEVICE_PER_HOUR_MAX },
    command: { mode: 'allow', perHour: DEVICE_PER_HOUR_MAX },
    browser: { mode: 'allow', perHour: DEVICE_PER_HOUR_MAX },
    input: { mode: 'allow', perHour: DEVICE_PER_HOUR_MAX },
  },
};

export const PROTECTED_DEVICE_PATHS: readonly { pattern: string; why: string }[] = [];
