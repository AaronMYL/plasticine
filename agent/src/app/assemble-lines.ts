// 新内核（lines/）在整个服务里的装配：模型从哪来、事件推到哪条流、要你定卡挂到哪张桌子、带哪些业务工具、一轮停下以后
// 告诉谁（记忆整理、跨用户任务的交付）。
// 业务工具（第三级）从旧注册表里按名字取已经装好的那件，包成新内核的工具：执行逻辑不重写，工具组开关照旧生效。

import type { AskDesk } from '../attention/index.ts';
import type { PermissionGate, Tool, ToolRegistry } from '../brain/index.ts';
import { adaptLegacyTool, conversationSearchTool, forgetTool, LineKernel, legacySayings, rememberTool,
  serverCommandTool, type Compactor, type KernelTool, type Later, type ModelSource, type SubmitHoldPort }
  from '../lines/index.ts';
import type { MessageWidget } from '../../shared/api/message-widgets.ts';
import type { DriveOutcome, KernelOptions } from '../lines/index.ts';
import type { LineRow, StateService } from '../state/index.ts';
import type { EventHub } from './event-hub.ts';

export interface LineAssembly {
  models: ModelSource;
  /** 测试再加自己的工具。 */
  tools?: (parts: LineParts) => KernelTool[];
  compact?: Compactor;
  later?: Later;
  maxBackground?: number;
}

/** 旧工具在新内核里用到的那几样：注册表（取工具、看开关）、设备动作的权限门、干跑开关。 */
export interface LegacyParts {
  registry: ToolRegistry;
  permission: PermissionGate;
  dryRun: boolean;
  /** SSH 传输是否已装好，与用户开关分别判断。 */
  sshAvailable?: boolean;
  /** 提交前问他：设备那边这条线被拦下的提交。 */
  submits: SubmitHoldPort;
  /** 卡片小部件：新内核要一件记到这次调用结果里的（旧的那件记进 run_events，线上没有 run）。 */
  widgets: (recorder: { shown(runId: string, callId: string, widgets: MessageWidget[]): void }) => Tool;
}

export interface LineParts {
  state: StateService;
  desk: AskDesk;
  hub: EventHub;
  now: () => Date;
  publicUrl: () => string;
  legacy?: LegacyParts;
  /** 别的模块交来的工具（网络的发任务卡）。 */
  tools?: readonly KernelTool[];
  turnEnded?: (line: LineRow, outcome: DriveOutcome) => void;
  /** 后台线的结果要贴回发起它的线时（贴回主线的发系统通知）。 */
  reported?: KernelOptions['reported'];
  lineChanged?: (lineId: string) => void;
  skillsContext?: (lineId: string) => string;
  /** 要出卡等他答的业务工具（起草定时卡，tasks/）。 */
  askTools?: KernelOptions['askTools'];
}

const DEFAULT_ZONE = 'Asia/Shanghai';

const PLATFORM_LABELS: Readonly<Record<string, string>> = { macos: 'Mac', ios: 'iPhone', windows: 'Windows 电脑',
  linux: 'Linux 电脑', browser: '浏览器' };

function legacyTools(parts: LineParts, legacy: LegacyParts): KernelTool[] {
  const { registry } = legacy;
  const offered = (name: string): boolean => registry.isOffered(name, 'conversation')
    || registry.isOffered(name, 'worker');
  const options = { dryRun: legacy.dryRun, now: parts.now, enabled: offered };
  const nodeLabel = (nodeId: string): string => {
    const node = parts.state.nodes.get(nodeId);
    return node === undefined ? '设备' : PLATFORM_LABELS[node.platform] ?? node.name;
  };
  const sayings = legacySayings(nodeLabel);
  const shown = new Map<string, MessageWidget[]>();
  const widgets = legacy.widgets({ shown: (runId, callId, list) => shown.set(`${runId}:${callId}`, list) });
  const tools: KernelTool[] = [];
  for (const [name, meta] of Object.entries(sayings)) {
    const tool = name === 'show_widgets' ? widgets : registry.get(name);
    if (tool === undefined) {
      continue;
    }
    const withDetails = name === 'show_widgets' ? { ...meta, details: (actionId: string) => {
      const list = shown.get(actionId);
      shown.delete(actionId);
      return { widgets: list ?? [] };
    } } : meta;
    // 卡片小部件不在注册表里（每个装配单独造），不归任何工具组，一直在。
    const own = name === 'show_widgets' ? { dryRun: options.dryRun, now: options.now } : options;
    tools.push(adaptLegacyTool(tool, withDetails, name === 'device_action'
      ? { ...own, permission: legacy.permission } : own));
  }
  const local = registry.get('server_exec');
  if (local !== undefined) {
    const remote = legacy.sshAvailable === false ? undefined : registry.get('cloud_ssh_run');
    tools.push(serverCommandTool({ local, remote }, options));
  }
  tools.push(rememberTool(parts.state), forgetTool(parts.state));
  // 翻对话（第 17、20 条）：只读，查统一全文索引里所有线上的原话。
  tools.push(conversationSearchTool(parts.state));
  return tools;
}

export function assembleLines(assembly: LineAssembly, parts: LineParts): LineKernel {
  return new LineKernel({
    state: parts.state,
    desk: parts.desk,
    models: assembly.models,
    publish: (event) => {
      parts.hub.publish(event);
      if (event.type === 'line_changed') {
        parts.lineChanged?.(event.line.id);
      }
    },
    tools: [...(parts.legacy === undefined ? [] : legacyTools(parts, parts.legacy)), ...parts.tools ?? [],
      ...assembly.tools?.(parts) ?? []],
    now: parts.now,
    // 主线和旁聊按他设置里的时区分天（第 17 条）；没设按北京时间。
    zone: () => parts.state.dailySettings.read().settings.timeZone ?? DEFAULT_ZONE,
    publicUrl: parts.publicUrl,
    ...(parts.legacy === undefined ? {} : { submits: parts.legacy.submits }),
    ...(assembly.later === undefined ? {} : { later: assembly.later }),
    ...(assembly.maxBackground === undefined ? {} : { maxBackground: assembly.maxBackground }),
    ...(assembly.compact === undefined ? {} : { compact: assembly.compact }),
    ...(parts.turnEnded === undefined ? {} : { turnEnded: parts.turnEnded }),
    ...(parts.reported === undefined ? {} : { reported: parts.reported }),
    ...(parts.skillsContext === undefined ? {} : { skillsContext: parts.skillsContext }),
    ...(parts.askTools === undefined ? {} : { askTools: parts.askTools }),
  });
}
