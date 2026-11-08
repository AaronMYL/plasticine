// 设备侧上限的默认值和受保护路径（M5）。
// 第 97 条（10-29）：用户的 Mac 是 Plasticine 的电脑。服务端不再设受保护路径；授权目录、站点、应用清单默认为空，空就是不限，
// 由 Mac 端自己守它的授权目录（你在设备上点的那几个）；每小时次数取上限值；删除照旧逐次确认（10-25 定）。

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

/**
 * 受保护路径：glob，`**` 跨目录，`*` 不跨；不分大小写。第 97 条起为空——服务端不按路径拦，设备页也不再列这一栏。
 */
export const PROTECTED_DEVICE_PATHS: readonly { pattern: string; why: string }[] = [];
