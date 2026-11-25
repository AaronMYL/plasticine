import type { Migration } from './migrate.ts';

const OWN_NOTICE = `source = 'email' AND trim(from_address) <> ''
  AND instr(lower(coalesce(to_address, '')), lower(trim(from_address))) > 0
  AND substr(title, 1, 10) = 'Plasticine'
  AND substr(ltrim(substr(title, 11), ' '), 1, 1) IN ('·', '：', ':')`;

const STRIPPED = "trim(substr(ltrim(substr(title, 11), ' '), 2), ' ')";

export const migration: Migration = {
  id: '0048-own-notices',
  up(db) {
    db.exec(`UPDATE triggers SET actor = 'plasticine', actor_source_kind = 'own_reasoning'
      WHERE ref_type = 'inbox_message' AND ref_id IN (SELECT id FROM inbox_messages WHERE ${OWN_NOTICE})`);
    db.exec(`UPDATE inbox_messages SET
      source = 'plasticine',
      from_address = 'plasticine',
      from_name = NULL,
      title = CASE WHEN ${STRIPPED} = '' THEN '（没有标题）' ELSE ${STRIPPED} END,
      version = version + 1
      WHERE ${OWN_NOTICE}`);
  },
};
