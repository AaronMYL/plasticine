// 这条线在一个网页标签上做过什么（照卡发送和 page_send 核「在哪个网站、填进去的是什么」用）：最近看到的地址、最近
// 填进去的原文。粘贴进去的不拿「之前填的」或「最后一段」顶替：要从头把这一页读完、在正文里找到粘进去的全文才算数。
// 网页标签的每种动作会不会改页面也在这里表态（提交被拦下以后又改过页面，那次拦下不再作数）。

import type { DeviceActionKind, NodeAction } from '../../shared/state.ts';
import type { StateService } from '../state/index.ts';

type ActionsState = Pick<StateService, 'nodeActions'>;
type TabKind = Extract<DeviceActionKind, `tab_${string}`>;

/**
 * 网页标签的每一种动作会不会改页面。11-17：按键、粘贴、上传、拖动、答弹框是 11-16 加的动作，当时没登记成「会改」，
 * 粘贴以后照样拿旧的拦下去发。改成每种都要表态：新加一种 tab_ 动作时漏了这里，类型检查不过。
 */
const TAB_KIND_CHANGES: Readonly<Record<TabKind, boolean>> = {
  tab_list: false,
  tab_read: false,
  tab_perceive: false,
  tab_shot: false,
  tab_wait: false,
  tab_scroll: false,
  tab_hover: false,
  tab_downloads: false,
  // 开新标签不动这个标签；关掉、提到前面给他接手都不是 Plasticine 在页面上改东西。
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

/** 这种动作会改网页标签上的东西（点、填、打字、按键、粘贴、上传、拖动、答弹框、换地址）。 */
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

/** 这一下往输入框里放进去的原文：按编号填（tab_act 的 fill）、按选择器填（tab_fill）、往焦点里打字（tab_type）。 */
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

/** 从头接着读的一串 tab_read：text 是已经读到的正文，next 是下一段该从哪读（读完了是 null）。 */
interface Readback {
  text: string;
  next: number | null;
}

/** 一次 tab_read 接到前面读的那一串后面：从 0 读起是新的一串，接不上（跳着读）就作废。 */
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

/**
 * 在读完的整页正文里找粘进去的全文（几段按顺序连起来）。找的时候不看空白（编辑器会改换行和空格），回的是页面上那一段
 * 的原样文字，授权和发送都照它核；找不到、或者同样的字出现两处分不清是哪一处，回 null。
 */
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

/** 这条线在这个标签上最近看到的页面地址、最近一次填进去的字（照卡发送和 page_send 核网站和内容用）。 */
export interface TabTrace {
  url: string | null;
  filled: string | null;
  /** 粘贴过、还没有从头读完这一页核对上：这时 filled 是 null，要发得先回读。 */
  unverifiedPaste: boolean;
}

interface Typed {
  filled: string | null;
  /** 粘贴进去的几段（粘贴之前填着的那段排第一）；空的是没粘贴过。 */
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
  // 粘贴以后按过键（删字、换掉选中的一段）：输入框里是什么只凭参数算不出来，重新回读。
  if (row.kind === 'tab_key') {
    return { ...typed, filled: null, unverified: true, read: null };
  }
  // 读到一半页面又被改过：这一串不作数，从头再读。
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

/** 两处发送的门共用的一句：粘贴进去的还没核对上，不发。 */
export const UNVERIFIED_PASTE = '粘贴进去的正文还没有回读核对，没有发：用 tab_read 从 offset 0 把这一页读完'
  + '（nextOffset 不是 null 就接着读到是 null），再照读回来的那段原文写要发的内容。';
