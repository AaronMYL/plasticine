// 每日设置（M4）：一行 JSON。没存过就是默认值（version 0）；改动带期望版本，不对就 version_conflict、不覆盖。迁移只在
// 还没有这一行时写一次（旧 daily/settings.json 的十件事上限），重跑是空操作，用户在新版改过的不会被旧值盖掉。

import {
  DAILY_SETTINGS_DEFAULTS,
  DailySettingsPatchSchema,
  DailySettingsRowSchema,
  DailySettingsSchema,
  type DailySettings,
  type DailySettingsPatch,
  type DailySettingsRow,
} from '../../shared/state.ts';
import { checked, readRow, type ColumnMap } from './codec.ts';
import { StateError, versionConflict } from './errors.ts';
import { isTimeZone } from '../../shared/time-zone.ts';
import type { StoreContext } from './object-store.ts';

const ROW_ID = 'daily';
const COLUMNS: ColumnMap = {
  value: 'json',
  version: 'integer',
  updatedAt: 'text',
  migratedDefault: 'boolean',
  legacyPayload: 'json',
};
const INSERT_SQL = `INSERT INTO daily_settings (id, value, version, updated_at, migrated_default, legacy_payload)
  VALUES ($id, $value, 1, $updated_at, $migrated_default, $legacy_payload)`;
const UPDATE_SQL = `UPDATE daily_settings SET value = $value, version = version + 1, updated_at = $updated_at
  WHERE id = $id AND version = $expected`;

export interface SettingsRead {
  settings: DailySettings;
  /** 0 until the settings were saved once. */
  version: number;
  migrated: boolean;
}

export function createDailySettingsStore(context: StoreContext) {
  function row(): DailySettingsRow | undefined {
    const found = context.db.get('SELECT * FROM daily_settings WHERE id = $id', { id: ROW_ID });
    return found === undefined ? undefined : readRow(DailySettingsRowSchema, COLUMNS, found, 'daily_settings');
  }

  function read(): SettingsRead {
    const stored = row();
    if (stored === undefined) {
      return { settings: { ...DAILY_SETTINGS_DEFAULTS }, version: 0, migrated: false };
    }
    return { settings: stored.value, version: stored.version, migrated: stored.migratedDefault };
  }

  function insert(value: DailySettings, migrated: boolean, legacyPayload: unknown): void {
    context.db.run(INSERT_SQL, {
      id: ROW_ID,
      value: JSON.stringify(value),
      updated_at: context.now(),
      migrated_default: migrated ? 1 : 0,
      legacy_payload: legacyPayload === null ? null : JSON.stringify(legacyPayload),
    });
  }

  return {
    read,
    save(expectedVersion: number, patch: DailySettingsPatch): SettingsRead {
      const changes = checked(DailySettingsPatchSchema, patch, 'invalid_input', '改每日设置');
      if (changes.timeZone != null && !isTimeZone(changes.timeZone)) {
        throw new StateError('invalid_input', '不认识这个时区，请用 IANA 时区名。', { field: 'timeZone' });
      }
      return context.db.transaction(() => {
        const current = read();
        if (current.version !== expectedVersion) {
          throw versionConflict('daily_settings', ROW_ID, expectedVersion, current.version);
        }
        const next = checked(DailySettingsSchema, { ...current.settings, ...changes }, 'invalid_input', '改每日设置');
        if (current.version === 0) {
          insert(next, false, null);
        } else {
          context.db.run(UPDATE_SQL, {
            id: ROW_ID,
            value: JSON.stringify(next),
            updated_at: context.now(),
            expected: expectedVersion,
          });
        }
        return read();
      });
    },
    /** Migration only: writes `patch` over the defaults if nothing was saved yet; returns whether it wrote. */
    importOnce(patch: DailySettingsPatch, legacyPayload: unknown): boolean {
      const changes = checked(DailySettingsPatchSchema, patch, 'invalid_input', '迁入每日设置');
      return context.db.transaction(() => {
        if (row() !== undefined) {
          return false;
        }
        const value = checked(
          DailySettingsSchema,
          { ...DAILY_SETTINGS_DEFAULTS, ...changes },
          'invalid_input',
          '迁入每日设置',
        );
        insert(value, true, legacyPayload);
        return true;
      });
    },
    row,
  };
}

export type DailySettingsStore = ReturnType<typeof createDailySettingsStore>;
