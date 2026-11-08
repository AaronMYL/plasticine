// 主人账号（2026-11-08《首次使用流程》：去掉设备码，改用「@账号 + 密码」；一份 Plasticine 只有一个主人）。一行：
// 名字（没加入网络时名字只存在这里；加入了以网络身份的为准，改名时两处一起改）、密码的 scrypt 哈希和盐、设置时间、
// setup-link 命令发的一次性建账号令牌（只存 SHA-256 和过期时间）。只加表；明文的密码和令牌都不进库。

import type { Migration } from './migrate.ts';

const OWNER = `CREATE TABLE owner_account (
  id TEXT PRIMARY KEY NOT NULL CHECK (id = 'owner'),
  display_name TEXT,
  password_hash TEXT,
  password_salt TEXT,
  password_set_at TEXT,
  setup_token_hash TEXT,
  setup_token_expires_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK ((password_hash IS NULL) = (password_salt IS NULL)),
  CHECK ((password_hash IS NULL) = (password_set_at IS NULL)),
  CHECK ((setup_token_hash IS NULL) = (setup_token_expires_at IS NULL))
)`;

export const migration: Migration = {
  id: '0111-owner-account',
  up(db) {
    db.exec(OWNER);
  },
};
