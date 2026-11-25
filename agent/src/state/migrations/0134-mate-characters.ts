import { autoMateCharacter, isMateCharacter } from '../../../shared/api/mate-characters.ts';
import type { Migration } from './migrate.ts';

export const migration: Migration = {
  id: '0134-mate-characters',
  up(db) {
    const rows = db.all('SELECT id, name, avatar FROM mates ORDER BY created_at, id');
    const taken = new Set(rows.map((row) => row['avatar']).filter(isMateCharacter));
    for (const row of rows) {
      if (!isMateCharacter(row['avatar'])) {
        const avatar = autoMateCharacter(String(row['name']), taken);
        taken.add(avatar);
        db.run('UPDATE mates SET avatar = $avatar WHERE id = $id', { id: String(row['id']), avatar });
      }
    }
    const main = db.all("SELECT value FROM kernel_settings WHERE key = 'main_identity'")[0];
    if (main !== undefined) {
      const stored = JSON.parse(String(main['value'])) as unknown;
      const name = typeof stored === 'object' && stored !== null ? (stored as Record<string, unknown>)['name'] : null;
      if (typeof name === 'string') {
        db.run("UPDATE kernel_settings SET value = $value WHERE key = 'main_identity'",
          { value: JSON.stringify({ name }) });
      }
    }
  },
};
