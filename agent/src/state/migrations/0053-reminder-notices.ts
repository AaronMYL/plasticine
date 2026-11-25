import type { Migration } from './migrate.ts';

const OWN_REMINDER = `source = 'email' AND trim(from_address) <> ''
  AND instr(lower(coalesce(to_address, '')), lower(trim(from_address))) > 0
  AND substr(title, 1, 3) = '提醒：'`;

export const migration: Migration = {
  id: '0053-reminder-notices',
  up(db) {
    db.exec(`UPDATE triggers SET actor = 'plasticine', actor_source_kind = 'own_reasoning'
      WHERE ref_type = 'inbox_message' AND ref_id IN (SELECT id FROM inbox_messages WHERE ${OWN_REMINDER})`);
    db.exec(`UPDATE inbox_messages SET source = 'plasticine', from_address = 'plasticine', from_name = NULL,
      version = version + 1
      WHERE ${OWN_REMINDER}`);
  },
};
