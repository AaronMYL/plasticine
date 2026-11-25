import type { DeviceActionKind, NodeAction } from '../../shared/state.ts';
import type { StateService } from '../state/index.ts';

type ActionsState = Pick<StateService, 'nodeActions'>;
type TabKind = Extract<DeviceActionKind, `tab_${string}`>;

const TAB_KIND_CHANGES: Readonly<Record<TabKind, boolean>> = {
  tab_list: false,
  tab_read: false,
  tab_perceive: false,
  tab_shot: false,
  tab_wait: false,
  tab_scroll: false,
  tab_hover: false,
  tab_downloads: false,
  tab_open: false,
  tab_close: false,
  tab_show: false,
  tab_navigate: true,
  tab_click: true,
  tab_fill: true,
  tab_act: true,
  tab_point: true,
  tab_type: true,
  tab_key: true,
  tab_paste: true,
  tab_upload: true,
  tab_drag: true,
  tab_dialog: true,
};

export function changesTab(kind: string): boolean {
  return Object.hasOwn(TAB_KIND_CHANGES, kind) && TAB_KIND_CHANGES[kind as TabKind];
}

function actionOf(row: NodeAction): object | null {
  const envelope = row.envelope;
  if (typeof envelope !== 'object' || envelope === null) {
    return null;
  }
  const action: unknown = Reflect.get(envelope, 'action');
  return typeof action === 'object' && action !== null ? action : null;
}

export function tabIdOf(row: NodeAction): string | null {
  const action = actionOf(row);
  const tabId: unknown = action === null ? null : Reflect.get(action, 'tabId');
  return typeof tabId === 'string' ? tabId : null;
}

function textField(action: object | null, key: string): string | null {
  const value: unknown = action === null ? null : Reflect.get(action, key);
  return typeof value === 'string' ? value : null;
}

function filledBy(row: NodeAction): string | null {
  const action = actionOf(row);
  if (row.kind === 'tab_fill') {
    return textField(action, 'value');
  }
  if (row.kind === 'tab_type') {
    return textField(action, 'text');
  }
  if (row.kind !== 'tab_act' || action === null) {
    return null;
  }
  const act: unknown = Reflect.get(action, 'act');
  const fill = typeof act === 'object' && act !== null && Reflect.get(act, 'op') === 'fill';
  return fill ? textField(act, 'value') : null;
}

function urlOf(result: unknown): string | null {
  if (typeof result !== 'object' || result === null) {
    return null;
  }
  for (const key of ['after', 'page']) {
    const part: unknown = Reflect.get(result, key);
    const url: unknown = typeof part === 'object' && part !== null ? Reflect.get(part, 'url') : null;
    if (typeof url === 'string' && url !== '') {
      return url;
    }
  }
  const url: unknown = Reflect.get(result, 'url');
  return typeof url === 'string' && url !== '' ? url : null;
}

interface Readback {
  text: string;
  next: number | null;
}

function readOn(before: Readback | null, result: unknown): Readback | null {
  if (typeof result !== 'object' || result === null) {
    return null;
  }
  const text: unknown = Reflect.get(result, 'text');
  const offset: unknown = Reflect.get(result, 'offset');
  const next: unknown = Reflect.get(result, 'nextOffset');
  if (typeof text !== 'string' || typeof offset !== 'number' || (next !== null && typeof next !== 'number')) {
    return null;
  }
  if (offset === 0) {
    return { text, next };
  }
  return before !== null && before.next === offset ? { text: before.text + text, next } : null;
}

export function pastedOnPage(page: string, parts: readonly string[]): string | null {
  const wanted = parts.join('').replace(/\s/g, '');
  if (wanted === '') {
    return null;
  }
  const positions: number[] = [];
  let compact = '';
  for (let index = 0; index < page.length; index += 1) {
    const char = page.charAt(index);
    if (!/\s/.test(char)) {
      compact += char;
      positions.push(index);
    }
  }
  const at = compact.indexOf(wanted);
  if (at < 0 || compact.indexOf(wanted, at + 1) >= 0) {
    return null;
  }
  const first = positions[at];
  const last = positions[at + wanted.length - 1];
  return first === undefined || last === undefined ? null : page.slice(first, last + 1);
}

export interface TabTrace {
  url: string | null;
  filled: string | null;
  unverifiedPaste: boolean;
}

interface Typed {
  filled: string | null;
  pasted: string[];
  unverified: boolean;
  read: Readback | null;
}

const BLANK: Typed = { filled: null, pasted: [], unverified: false, read: null };

function afterPaste(typed: Typed, text: string | null): Typed {
  const before = typed.pasted.length === 0 && typed.filled !== null && typed.filled !== '' ? [typed.filled] : [];
  const pasted = [...typed.pasted, ...before, ...(text === null ? [] : [text])];
  return { filled: null, pasted, unverified: true, read: null };
}

function afterRead(typed: Typed, result: unknown): Typed {
  const read = readOn(typed.read, result);
  if (read === null || read.next !== null) {
    return { ...typed, read };
  }
  const found = pastedOnPage(read.text, typed.pasted);
  return { ...typed, filled: found, unverified: found === null, read };
}

function step(typed: Typed, row: NodeAction): Typed {
  const filled = filledBy(row);
  if (filled !== null) {
    return { ...BLANK, filled };
  }
  if (row.kind === 'tab_navigate') {
    return BLANK;
  }
  if (row.kind === 'tab_paste') {
    return afterPaste(typed, textField(actionOf(row), 'text'));
  }
  if (typed.pasted.length === 0) {
    return typed;
  }
  if (row.kind === 'tab_read') {
    return afterRead(typed, row.result);
  }
  if (row.kind === 'tab_key') {
    return { ...typed, filled: null, unverified: true, read: null };
  }
  return changesTab(row.kind) ? { ...typed, read: null } : typed;
}

export function tabTrace(state: ActionsState, runId: string, nodeId: string, tabId: string): TabTrace {
  let url: string | null = null;
  let typed = BLANK;
  for (const row of state.nodeActions.forRunNode(runId, nodeId)) {
    if (tabIdOf(row) !== tabId || row.status !== 'executed') {
      continue;
    }
    url = urlOf(row.result) ?? url;
    typed = step(typed, row);
  }
  return { url, filled: typed.filled, unverifiedPaste: typed.unverified };
}

export const UNVERIFIED_PASTE = '粘贴进去的正文还没有回读核对，没有发：用 tab_read 从 offset 0 把这一页读完'
  + '（nextOffset 不是 null 就接着读到是 null），再照读回来的那段原文写要发的内容。';
