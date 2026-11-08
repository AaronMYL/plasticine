// 设备的「本机」标记（2026-11-08《首次使用流程》）：桌面客户端凭本机令牌替本机界面登录的那台。设备列表据此显示
// 「这台电脑」；改密码时本机令牌请求可以不填旧密码。只加列，旧设备都是 0。

import type { Migration } from './migrate.ts';

export const migration: Migration = {
  id: '0112-device-local',
  up(db) {
    db.exec('ALTER TABLE devices ADD COLUMN local INTEGER NOT NULL DEFAULT 0 CHECK (local IN (0, 1))');
  },
};
