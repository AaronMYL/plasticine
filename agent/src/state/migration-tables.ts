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

export const INDEX_TABLES = ['search_docs', 'search_gaps', 'search_sources'] as const;
export const FTS_TABLES = [
  'search_fts', 'search_fts_config', 'search_fts_data', 'search_fts_docsize', 'search_fts_idx',
];
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
