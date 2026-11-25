export const DISCOVERY_TOOLS: ReadonlySet<string> = new Set(['tool_search', 'tool_describe']);

const FAMILIES: Readonly<Record<string, string>> = {
  read_line: 'lines-read',
  list_lines: 'lines-read',
  start_line: 'delegate',
  mate_handoff: 'delegate',
  tell_line: 'delegate',
  server_command: 'server',
  server_command_read: 'server',
  server_health: 'server',
  read_memory_doc: 'memory',
  search_memory: 'memory',
  conversation_search: 'memory',
  remember: 'memory-write',
  note_experience: 'memory-write',
  cloud_browser_open: 'cloud-browser',
  cloud_browser_observe: 'cloud-browser',
  cloud_browser_act: 'cloud-browser',
  cloud_browser_read: 'cloud-browser',
  cloud_browser_tabs: 'cloud-browser',
  web_search: 'web',
  web_fetch: 'web',
  space_read: 'space',
  space_list: 'space',
  space_write: 'space-write',
  space_edit: 'space-write',
  note_search: 'notes',
  note_read: 'notes',
};

function record(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

export function callName(name: string, args: unknown): string {
  if (name === 'tool_call') {
    const inner = record(args)['name'];
    return typeof inner === 'string' ? callName(inner, record(args)['arguments']) : name;
  }
  if (name === 'device_action') {
    const kind = record(record(args)['action'])['kind'];
    return typeof kind === 'string' ? `device_action:${kind}` : name;
  }
  return name;
}

function deviceFamily(kind: string): string {
  if (kind.startsWith('tab_') || kind.startsWith('browser_')) {
    return 'device-tab';
  }
  if (kind.startsWith('app_')) {
    return 'device-app';
  }
  if (kind.startsWith('input_') || kind === 'screen_capture') {
    return 'device-input';
  }
  if (kind.startsWith('file_')) {
    return 'device-file';
  }
  return kind === 'run_command' ? 'device-command' : `device-${kind}`;
}

export function familyOf(called: string): string {
  if (called.startsWith('device_action:')) {
    return deviceFamily(called.slice('device_action:'.length));
  }
  return FAMILIES[called] ?? called;
}

export type CaseMatch = 'exact' | 'family' | 'none';

export function judge(expected: readonly string[], got: readonly string[]): CaseMatch {
  const first = got[0];
  if (expected.length === 0 || first === undefined) {
    return expected.length === 0 && first === undefined ? 'exact' : 'none';
  }
  if (first === expected[0]) {
    return 'exact';
  }
  return expected.some((name) => familyOf(name) === familyOf(first)) ? 'family' : 'none';
}
