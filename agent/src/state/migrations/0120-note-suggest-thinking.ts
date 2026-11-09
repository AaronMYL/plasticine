// 2026-11-09 他定：笔记续写、主动补充不开思考（要停下就有、边生成边显示）。这两个用途的默认思考档改成「关」
// （shared/api/model-purposes.ts），已经单独选过思考档的（他线上两个都是「低」）改回跟随，让新的默认生效。
// 选的模型、别的用途、全局默认都不动；设置改了，版本加一，开着的设置页保存时会先重读。

import type { Migration } from './migrate.ts';

const KEY = 'model_purposes';
const PURPOSES = ['note_predict', 'note_interject'] as const;

function objectOf(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown> : null;
}

export const migration: Migration = {
  id: '0120-note-suggest-thinking',
  up(db) {
    const row = db.all('SELECT value FROM kernel_settings WHERE key = $key', { key: KEY })[0];
    const config = objectOf(row === undefined ? null : JSON.parse(String(row['value'])));
    const overrides = objectOf(config?.['overrides']);
    if (config === null || overrides === null) {
      return;
    }
    let changed = false;
    for (const purpose of PURPOSES) {
      const chosen = objectOf(overrides[purpose]);
      const thinking = chosen?.['thinking'];
      if (chosen !== null && typeof thinking === 'string' && thinking !== 'off') {
        overrides[purpose] = { ...chosen, thinking: null };
        changed = true;
      }
    }
    if (!changed) {
      return;
    }
    const version = typeof config['version'] === 'number' ? config['version'] : 0;
    const at = String(db.all("SELECT strftime('%Y-%m-%dT%H:%M:%fZ', 'now') AS now")[0]?.['now']);
    db.run('UPDATE kernel_settings SET value = $value, updated_at = $at WHERE key = $key',
      { key: KEY, value: JSON.stringify({ ...config, overrides, version: version + 1 }), at });
  },
};
