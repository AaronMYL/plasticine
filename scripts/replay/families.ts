// 回放怎么判对错（内核优化第三批，11-17）：拿线上那一次模型实际调的第一个工具当「答案」，看现在的提示词和工具面下
// 模型调的是不是同一个，或者至少是同一类。名字不同但干的是同一件事的算同一类（读线和列线、跑命令和读命令输出）。
// tool_call（第四批的按需调用）按它里面真正调的那件算；device_action 按动作分到网页标签、本机应用、真键鼠这几类。

/** 只是去找工具、看说明的调用：回放里照常执行，不算模型「做了什么」。 */
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

/** 一次调用的叫法：tool_call 拆开；device_action 带上动作。 */
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

/** 一次调用属于哪一类。 */
export function familyOf(called: string): string {
  if (called.startsWith('device_action:')) {
    return deviceFamily(called.slice('device_action:'.length));
  }
  return FAMILIES[called] ?? called;
}

export type CaseMatch = 'exact' | 'family' | 'none';

/**
 * 判一件：expected 是线上那一次调的（按顺序），got 是这次调的（去掉找工具的）。第一个一样算 exact；
 * 这次的第一个和线上任何一个同类算 family；都没调工具也算 exact（线上是直接答的）。
 */
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
