// 一个设备动作发出之前的检查，顺序照 harness 5.2 第 3 步：路径格式 → 设备上限（这一类许不许、在不在授权范围、
// 要不要逐次确认、无人时许不许点击输入、这一小时的次数）。哪一层不过就停在哪一层，报出那一层和一句原因；不排队、不重试。
// 约定和逐次批准是之后两层，不在这里（brain/ 的 PermissionGate）。

import {
  DEVICE_CLASS_LABELS,
  DEVICE_KIND_CLASSES,
  DEVICE_KIND_LABELS,
  type DeviceActionParams,
} from '../../shared/api/index.ts';
import type { DeviceActionClass, DeviceLimits, NodeRefusalLayer } from '../../shared/state.ts';
import { deletesFiles, normalizeDevicePath, pathsInCommand, withinRoots } from './paths.ts';

export interface Refusal {
  layer: NodeRefusalLayer;
  reason: string;
}

export interface ActionFacts {
  /** The class the action counts against (a deleting command counts as 删). */
  actionClass: DeviceActionClass;
  /** What it is about, for the record and the sentence: a path, a site, an app, the start of a command. */
  target: string;
}

const NOT_SENT = '这次没有发出，也不排队。';
// A command shows as its first 120 characters in the record; the rest may hold anything.
const COMMAND_PREVIEW_CHARS = 120;
// A calendar or reminder title, a shortcut name in the record: enough to recognise it in one line.
const TITLE_CHARS = 60;

function clipped(text: string, max: number): string {
  const chars = Array.from(text);
  return chars.length <= max ? text : `${chars.slice(0, max - 1).join('')}…`;
}

export function factsOf(action: DeviceActionParams): ActionFacts {
  const actionClass = DEVICE_KIND_CLASSES[action.kind];
  switch (action.kind) {
    case 'file_list':
    case 'file_read':
    case 'file_write':
    case 'file_delete':
      return { actionClass, target: action.path };
    case 'run_command':
      return {
        actionClass: deletesFiles(action.command) ? 'delete' : actionClass,
        target: `${action.cwd} $ ${clipped(action.command, COMMAND_PREVIEW_CHARS)}`,
      };
    case 'browser_open':
    case 'browser_read':
      return { actionClass, target: action.url };
    case 'app_open':
      return { actionClass, target: action.app };
    case 'calendar_create':
    case 'reminder_create':
      return { actionClass, target: `${DEVICE_KIND_LABELS[action.kind]}「${clipped(action.title, TITLE_CHARS)}」` };
    case 'shortcut_run':
      return { actionClass, target: `快捷指令「${clipped(action.name, TITLE_CHARS)}」` };
    case 'calendar_list':
      return { actionClass, target: `${DEVICE_KIND_LABELS[action.kind]} ${action.from} – ${action.to}` };
    case 'reminder_complete':
      return { actionClass, target: `${DEVICE_KIND_LABELS[action.kind]} ${action.reminderId}` };
    case 'photo_read':
      return { actionClass, target: `${DEVICE_KIND_LABELS[action.kind]} ${action.photoId}` };
    case 'screen_capture':
    case 'input_click':
    case 'input_type':
    case 'tab_list':
    case 'reminder_list':
    case 'photo_list':
    case 'location_current':
      return { actionClass, target: DEVICE_KIND_LABELS[action.kind] };
    case 'tab_open':
      return { actionClass, target: action.url };
    case 'tab_navigate':
      return { actionClass, target: `标签 ${action.tabId} → ${action.url}` };
    case 'tab_read':
      return { actionClass, target: `标签 ${action.tabId}` };
    case 'tab_click':
      return { actionClass, target: `标签 ${action.tabId} 点「${clipped(action.selector ?? action.text ?? '', 80)}」` };
    case 'tab_fill':
      // 只记填到哪个框，不记填的字（可能是用户的私人内容）。
      return { actionClass, target: `标签 ${action.tabId} 填「${clipped(action.selector, 80)}」` };
    case 'tab_perceive':
      return { actionClass, target: `标签 ${action.tabId}` };
    case 'tab_act':
      // 记这一步的那一句和编号，不记要填的字（同 tab_fill）。
      return { actionClass, target: `标签 ${action.tabId} ${clipped(action.step, 40)}`
        + (action.act.op === 'scroll' ? '' : `（#${action.act.n}）`) };
  }
}

// tab_click 的选择器和字恰好给一项：设备不替云端猜按哪个找。
function tabParamsRefusal(action: DeviceActionParams): Refusal | undefined {
  if (action.kind === 'tab_click' && (action.selector === null) === (action.text === null)) {
    return { layer: 'params', reason: `点网页标签要给选择器或按钮上的字，恰好一项；${NOT_SENT}` };
  }
  return undefined;
}

/** The paths an action touches; a command's working directory and every path it names. */
function pathsOf(action: DeviceActionParams): string[] {
  switch (action.kind) {
    case 'file_list':
    case 'file_read':
    case 'file_write':
    case 'file_delete':
      return [action.path];
    case 'run_command':
      return [action.cwd, ...pathsInCommand(action.command)];
    default:
      return [];
  }
}

// 第 97 条（10-29）：服务端只查路径写得对不对，不再按受保护路径拦；Mac 端自己守授权目录、删除逐次确认。
function pathRefusal(action: DeviceActionParams): Refusal | undefined {
  for (const raw of pathsOf(action)) {
    const normalized = normalizeDevicePath(raw);
    if (!normalized.ok) {
      return { layer: 'params', reason: `${normalized.reason}${NOT_SENT}` };
    }
  }
  return undefined;
}

function hostOf(url: string): string | undefined {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch (error) {
    if (error instanceof TypeError) {
      return undefined;
    }
    throw error;
  }
}

/** A site entry `example.com` allows the host and its subdomains. */
function siteAllowed(host: string, sites: readonly string[]): boolean {
  return sites.some((site) => {
    const allowed = site.toLowerCase();
    return host === allowed || host.endsWith(`.${allowed}`);
  });
}

// 第 97 条（10-29）：服务端的目录 / 站点 / 应用清单为空就是不限（设备端自己守它的授权目录）；用户设了才按清单限。
function scopeRefusal(action: DeviceActionParams, limits: DeviceLimits): Refusal | undefined {
  switch (action.kind) {
    case 'file_list':
    case 'file_read':
    case 'file_write':
    case 'file_delete':
    case 'run_command': {
      const path = normalizeDevicePath(action.kind === 'run_command' ? action.cwd : action.path);
      if (path.ok && limits.roots.length > 0 && !withinRoots(path.path, limits.roots)) {
        const where = action.kind === 'run_command' ? '工作目录' : '';
        const reason = `「${path.path}」${where}不在这台节点授权的目录里；${NOT_SENT}要给它，在设备上授权这个目录。`;
        return { layer: 'scope', reason };
      }
      return undefined;
    }
    case 'browser_open':
    case 'browser_read':
    case 'tab_open':
    case 'tab_navigate': {
      const host = hostOf(action.url);
      if (host === undefined || (limits.sites.length > 0 && !siteAllowed(host, limits.sites))) {
        const reason = `站点「${host ?? action.url}」还没在这台节点上授权（逐站点授权）；${NOT_SENT}`;
        return { layer: 'scope', reason };
      }
      return undefined;
    }
    case 'app_open':
      if (limits.apps.length > 0 && !limits.apps.includes(action.app)) {
        return { layer: 'scope', reason: `应用「${action.app}」不在这台节点可调用的应用里；${NOT_SENT}` };
      }
      return undefined;
    default:
      return undefined;
  }
}

export interface LimitCheckInput {
  action: DeviceActionParams;
  limits: DeviceLimits;
  /** How many actions of the action's class went out in the last hour. */
  usedThisHour: (actionClass: DeviceActionClass) => number;
  /** Whether someone is at the device; only matters for 点击输入 when unattendedInput is off. */
  attended: boolean;
  /** A signed answer for this exact action, supplied by the service, never by tool parameters. */
  confirmed?: boolean;
}

/** Null when every check passes; otherwise the first layer that refuses. */
export function checkAction(input: LimitCheckInput): Refusal | null {
  const { action, limits } = input;
  const malformed = pathRefusal(action) ?? tabParamsRefusal(action);
  if (malformed !== undefined) {
    return malformed;
  }
  const { actionClass } = factsOf(action);
  const label = DEVICE_CLASS_LABELS[actionClass];
  const rule = limits.classes[actionClass];
  if (rule.mode === 'deny') {
    return { layer: 'class', reason: `这台节点的上限不许「${label}」这一类动作；${NOT_SENT}要放宽，在设备上改上限。` };
  }
  const scope = scopeRefusal(action, limits);
  if (scope !== undefined) {
    return scope;
  }
  if (rule.mode === 'confirm_each' && input.confirmed !== true) {
    const reason = `「${label}」要你在设备上逐次确认，这一步还没有你的确认；${NOT_SENT}`;
    return { layer: 'confirm', reason };
  }
  if (actionClass === 'input' && !limits.unattendedInput && !input.attended) {
    return { layer: 'unattended', reason: `设备前没人，这台节点的上限不许无人时点击输入；${NOT_SENT}` };
  }
  const used = input.usedThisHour(actionClass);
  if (used >= rule.perHour) {
    const reason = `「${label}」这一小时已经做了 ${used} 次，到了上限 ${rule.perHour} 次；${NOT_SENT}`;
    return { layer: 'count', reason };
  }
  return null;
}
