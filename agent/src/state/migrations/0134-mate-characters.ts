import { autoMateCharacter, isMateCharacter } from '../../../shared/api/mate-characters.ts';
import type { Migration } from './migrate.ts';

// 队友头像（11-13 Aaron 定）：头像文字换成 Plasticine-bot 的角色。旧的头像文字按队友名字自动分一个角色，颜色不变；
// 主线的头像固定成 Plasticine 的泥团，存着的头像字和颜色去掉，只留名字。不加列、不删行。
export const migration: Migration = {
  id: '0134-mate-characters',
  up(db) {
    for (const row of db.all('SELECT id, name, avatar FROM mates')) {
      if (!isMateCharacter(row['avatar'])) {
        db.run('UPDATE mates SET avatar = $avatar WHERE id = $id',
          { id: String(row['id']), avatar: autoMateCharacter(String(row['name'])) });
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
