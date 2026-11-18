// 数据迁移（11-16）：库里每张表归哪一类。新表要在这里登记（migration-tables.test.ts 拿空库对一遍，漏了不过）。
//   content  他的东西：对话、记忆、笔记、书、空间、联系人、记账……两种导出都带；合并时加进这台没有的。
//   history  这台跑出来的记录和缓存（运行记录、回执、排队、叫醒、翻译缓存）：两种导出都带，替换时跟着换；合并时不要。
//   machine  密钥、登录、设备、地址和这台的设置：只有「全部导出」带；只要数据的那份替换时留这台的；合并不碰。
//   local    只属于这台机器的（备份登记、客户端发布、维护记录、接口去重时存的回答）：从不导出，替换时也留这台的。
//   index    全文索引：从原表算出来的，合并后重建。

export type MigrationTableClass = 'content' | 'history' | 'machine' | 'local' | 'index';

const CONTENT = [
  'asks', 'attachments', 'book_annotations', 'book_insights', 'book_progress', 'bookmarks', 'books',
  'contact_messages', 'contacts', 'feed_comments', 'feed_items', 'feed_sources', 'feed_translations',
  'group_messages', 'group_tasks', 'inbox_mail_parts', 'inbox_messages', 'inbox_replies', 'line_days',
  'line_messages', 'lines', 'loop_records', 'loop_self_notes', 'mate_groups', 'mates', 'memory_cleanups',
  'memory_conflicts', 'memory_doc_events', 'memory_doc_lines', 'memory_docs', 'memory_dream_changes', 'memory_dreams',
  'memory_entries', 'memory_inferences', 'memory_journal', 'money_accounts', 'money_categories', 'money_drafts',
  'money_entries', 'net_group_members', 'net_groups', 'net_responses', 'network_attachments', 'network_tasks',
  'note_folders', 'note_versions', 'notes', 'project_events', 'project_items', 'projects', 'pushes',
  'said_log', 'schedules', 'soul_revisions', 'souls', 'space_revisions', 'space_rewrites',
  'space_subscriptions', 'spaces', 'suggestions', 'versions', 'video_works', 'visibility_marks',
] as const;

const HISTORY = [
  'feed_fetch_runs', 'feed_refresh_runs', 'feed_source_status', 'heartbeat_beats', 'legacy_ids',
  'legacy_rows', 'line_approvals', 'line_queue', 'line_wakes', 'line_watches', 'memory_curation_jobs',
  'memory_doc_migration', 'memory_entry_migrations', 'model_calls', 'receipts', 'schedule_sends',
  'timed_slots', 'translation_cache', 'web_favicons',
] as const;

const MACHINE = [
  'calendar_snapshots', 'connections', 'daily_settings', 'device_time_zones', 'devices', 'inbox_sync',
  'kernel_credentials', 'kernel_settings', 'loop_grants',
  'network_identity', 'node_actions', 'node_pairing_codes', 'nodes', 'outbound_grants', 'outbound_log',
  'owner_account', 'push_subscriptions', 'sessions', 'tool_groups', 'translate_settings',
  'video_folders', 'video_mac_jobs', 'web_tab_groups', 'web_tab_layout',
  'web_tabs', 'web_tabs_closed',
] as const;

const LOCAL = [
  'api_requests', 'backups', 'client_publications', 'maintenance_operations', 'restore_previews',
] as const;

/** 全文索引的几张（FTS5 的影子表由 search_fts 自己管，不单独动）。 */
export const INDEX_TABLES = ['search_docs', 'search_gaps', 'search_sources'] as const;
/** FTS5 虚表和它的影子表：整库复制时跟着走，单独不动。 */
export const FTS_TABLES = [
  'search_fts', 'search_fts_config', 'search_fts_data', 'search_fts_docsize', 'search_fts_idx',
];
/** 迁移记录：跟着库走，不按类处理。 */
export const SCHEMA_TABLE = 'schema_migrations';

export const MIGRATION_TABLES: ReadonlyMap<string, MigrationTableClass> = new Map<string, MigrationTableClass>([
  ...CONTENT.map((name) => [name, 'content'] as const),
  ...HISTORY.map((name) => [name, 'history'] as const),
  ...MACHINE.map((name) => [name, 'machine'] as const),
  ...LOCAL.map((name) => [name, 'local'] as const),
  ...INDEX_TABLES.map((name) => [name, 'index'] as const),
]);

export function tablesOf(kind: MigrationTableClass): string[] {
  return [...MIGRATION_TABLES].filter(([, value]) => value === kind).map(([name]) => name);
}
