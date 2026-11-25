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
  actionClass: DeviceActionClass;
  /** What it is about, for the record and the sentence: a path, a site, an app, the start of a command. */
  target: string;
}

const NOT_SENT = '这次没有发出，也不排队。';
const COMMAND_PREVIEW_CHARS = 120;
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
    case 'file_fetch':
    case 'file_put':
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
    case 'screen_capture':
    case 'input_click':
    case 'input_type':
    case 'tab_list':
    case 'reminder_list':
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
      return { actionClass, target: `标签 ${action.tabId} 填「${clipped(action.selector, 80)}」` };
    case 'tab_perceive':
      return { actionClass, target: `标签 ${action.tabId}` };
    case 'tab_shot':
    case 'tab_close':
      return { actionClass, target: `标签 ${action.tabId}` };
    case 'tab_wait':
      return { actionClass, target: `标签 ${action.tabId} 等「${clipped(action.text, 40)}」${action.gone === true
        ? '消失' : '出现'}` };
    case 'tab_point':
      return { actionClass, target: `标签 ${action.tabId} 点 (${action.x}, ${action.y})` };
    case 'tab_type':
      return { actionClass, target: `标签 ${action.tabId} 打字` };
    case 'tab_key':
      return { actionClass, target: `标签 ${action.tabId} 按 ${action.key}` };
    case 'tab_scroll':
      return { actionClass, target: `标签 ${action.tabId} 在 (${action.x}, ${action.y}) 滚 ${action.dy}` };
    case 'tab_paste':
      return { actionClass, target: `标签 ${action.tabId} 粘贴` };
    case 'tab_show':
      return { actionClass, target: `标签 ${action.tabId}` };
    case 'tab_upload':
      return { actionClass, target: `标签 ${action.tabId} 上传「${clipped(action.files.map((file) => file.name)
        .join('、'), 80)}」（#${action.n}）` };
    case 'tab_act':
      return { actionClass, target: `标签 ${action.tabId} ${clipped(action.step, 40)}`
        + (action.act.n === undefined ? '' : `（#${action.act.n}）`) };
    default:
      return deskFacts(action, actionClass);
  }
}

function deskFacts(action: DeviceActionParams, actionClass: ActionFacts['actionClass']): ActionFacts {
  const label = DEVICE_KIND_LABELS[action.kind];
  switch (action.kind) {
    case 'file_find':
      return { actionClass, target: `${action.root} 找「${clipped(action.name, 40)}」` };
    case 'open_in_app':
      return { actionClass, target: `${action.app ?? '默认应用'} 打开 ${clipped(action.target, 120)}` };
    case 'calendar_update':
      return { actionClass, target: `${label} ${action.eventId}` };
    case 'tab_hover':
    case 'tab_drag':
    case 'tab_dialog':
      return { actionClass, target: `标签 ${action.tabId} ${label}` };
    case 'window_capture':
    case 'window_act':
      return { actionClass, target: `窗口 ${action.window} ${action.kind === 'window_act' ? action.op : ''}`.trim() };
    case 'app_perceive':
      return { actionClass, target: `${action.app} 的界面` };
    case 'app_act':
      return { actionClass, target: `${action.app} #${action.n} ${action.op}` };
    case 'app_menu':
      return { actionClass, target: `${action.app} 菜单${action.path === null ? '' : `「${clipped(action.path, 60)}」`}` };
    default:
      return { actionClass, target: label };
  }
}

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
    case 'file_fetch':
    case 'file_put':
      return [action.path];
    case 'run_command':
      return [action.cwd, ...pathsInCommand(action.command)];
    case 'file_find':
      return [action.root];
    default:
      return [];
  }
}

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

function scopeRefusal(action: DeviceActionParams, limits: DeviceLimits): Refusal | undefined {
  switch (action.kind) {
    case 'file_list':
    case 'file_read':
    case 'file_write':
    case 'file_delete':
    case 'file_fetch':
    case 'file_put':
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
