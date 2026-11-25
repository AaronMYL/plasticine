import { DEFAULT_TRANSLATE_SETTINGS } from '../../shared/api/translate.ts';
import { TranslateSettingsSchema, type TranslateSettings } from '../../shared/state.ts';
import { checked, encodeRow, readRow, sqlColumns, type ColumnMap } from './codec.ts';
import { versionConflict } from './errors.ts';
import type { StoreContext } from './object-store.ts';

const COLUMNS: ColumnMap = {
  id: 'text',
  createdAt: 'text',
  updatedAt: 'text',
  version: 'integer',
  target: 'text',
  display: 'text',
  glossary: 'boolean',
  alwaysSites: 'json',
};
const TABLE = 'translate_settings';
const ROW_ID = 'translate';

export type TranslateSettingsInput = Pick<TranslateSettings, 'target' | 'display' | 'glossary' | 'alwaysSites'>;

export function createTranslateSettingsStore(context: StoreContext) {
  function read(): TranslateSettings | undefined {
    const row = context.db.get(`SELECT * FROM ${TABLE} WHERE id = $id`, { id: ROW_ID });
    return row === undefined ? undefined : readRow(TranslateSettingsSchema, COLUMNS, row, TABLE);
  }

  return {
    /** The stored row, or the defaults at version 0 when nobody changed them yet. */
    get(): TranslateSettings {
      const now = context.now();
      return read() ?? { id: ROW_ID, createdAt: now, updatedAt: now, version: 0, ...DEFAULT_TRANSLATE_SETTINGS,
        alwaysSites: [...DEFAULT_TRANSLATE_SETTINGS.alwaysSites] };
    },
    set(expectedVersion: number, input: TranslateSettingsInput): TranslateSettings {
      return context.db.transaction(() => {
        const current = read();
        const version = current?.version ?? 0;
        if (version !== expectedVersion) {
          throw versionConflict(TABLE, ROW_ID, expectedVersion, version);
        }
        const now = context.now();
        const next = checked(TranslateSettingsSchema, {
          id: ROW_ID, createdAt: current?.createdAt ?? now, updatedAt: now, version: version + 1,
          target: input.target, display: input.display, glossary: input.glossary, alwaysSites: input.alwaysSites,
        }, 'invalid_input', '翻译设置');
        const params = encodeRow(COLUMNS, next);
        if (current === undefined) {
          const { names, placeholders } = sqlColumns(COLUMNS);
          context.db.run(`INSERT INTO ${TABLE} (${names}) VALUES (${placeholders})`, params);
        } else {
          const { created_at: _created, ...changed } = params;
          context.db.run(`UPDATE ${TABLE} SET target = $target, display = $display, glossary = $glossary,
            always_sites = $always_sites, updated_at = $updated_at, version = $version WHERE id = $id`, changed);
        }
        return next;
      });
    },
  };
}

export type TranslateSettingsStore = ReturnType<typeof createTranslateSettingsStore>;
