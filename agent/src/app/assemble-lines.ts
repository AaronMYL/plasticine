import type { AskDesk } from '../attention/index.ts';
import type { PermissionGate, Tool, ToolRegistry } from '../tools/index.ts';
import {
  adaptLegacyTool, attachmentReadTool, DIRECT_TOOLS, conversationSearchTool, effectiveLimit, experienceTool, forgetTool,
  legacySayings, LineKernel, machineLoad, readWorkLimit, rememberTool, serverCommandTool, type Compactor,
  type DriveOutcome, type KernelOptions, type KernelTool, type Later, type MachineLoad, type ModelSource,
  type SubmitHoldPort, tabHandoffTool, type AskToolHost,
} from '../lines/index.ts';
import type { MessageWidget } from '../../shared/api/message-widgets.ts';
import type { LineRow, StateService } from '../state/index.ts';
import type { EventHub } from './event-hub.ts';

export interface LineAssembly {
  models: ModelSource;
  tools?: (parts: LineParts) => KernelTool[];
  compact?: Compactor;
  later?: Later;
  maxBackground?: number;
  machineLoad?: () => MachineLoad;
}

export interface LegacyParts {
  registry: ToolRegistry;
  permission: PermissionGate;
  dryRun: boolean;
  sshAvailable?: boolean;
  submits: SubmitHoldPort;
  widgets: (recorder: { shown(runId: string, callId: string, widgets: MessageWidget[]): void }) => Tool;
  deviceTools?: (deviceAction: KernelTool) => KernelTool[];
}

export interface LineParts {
  state: StateService;
  desk: AskDesk;
  hub: EventHub;
  now: () => Date;
  publicUrl: () => string;
  legacy?: LegacyParts;
  tools?: readonly KernelTool[];
  turnEnded?: (line: LineRow, outcome: DriveOutcome) => void;
  reported?: KernelOptions['reported'];
  lineChanged?: (lineId: string) => void;
  skillsContext?: (lineId: string) => string;
  recall?: KernelOptions['recall'];
  contextImages?: KernelOptions['contextImages'];
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
    const own = name === 'show_widgets' ? { dryRun: options.dryRun, now: options.now } : options;
    tools.push(adaptLegacyTool(tool, withDetails, name === 'device_action'
      ? { ...own, permission: legacy.permission } : own));
  }
  const local = registry.get('server_exec');
  if (local !== undefined) {
    const remote = legacy.sshAvailable === false ? undefined : registry.get('cloud_ssh_run');
    tools.push(serverCommandTool({ local, remote }, options));
  }
  tools.push(rememberTool(parts.state), experienceTool(parts.state), forgetTool(parts.state));
  tools.push(conversationSearchTool(parts.state));
  tools.push(attachmentReadTool(parts.state));
  return tools;
}

export function assembleLines(assembly: LineAssembly, parts: LineParts): LineKernel {
  const legacy = parts.legacy === undefined ? [] : legacyTools(parts, parts.legacy);
  const deviceAction = legacy.find((tool) => tool.name === 'device_action');
  const wrapped = deviceAction === undefined ? [] : parts.legacy?.deviceTools?.(deviceAction) ?? [];
  const handoff = deviceAction === undefined ? []
    : [(host: AskToolHost): KernelTool => tabHandoffTool(host, deviceAction)];
  const askTools = [...parts.askTools ?? [], ...handoff];
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
    tools: [...legacy, ...wrapped, ...parts.tools ?? [], ...assembly.tools?.(parts) ?? []],
    directTools: DIRECT_TOOLS,
    now: parts.now,
    zone: () => parts.state.dailySettings.read().settings.timeZone ?? DEFAULT_ZONE,
    publicUrl: parts.publicUrl,
    ...(parts.legacy === undefined ? {} : { submits: parts.legacy.submits }),
    ...(assembly.later === undefined ? {} : { later: assembly.later }),
    maxBackground: assembly.maxBackground
      ?? (() => effectiveLimit(readWorkLimit(parts.state), (assembly.machineLoad ?? machineLoad)())),
    ...(assembly.compact === undefined ? {} : { compact: assembly.compact }),
    ...(parts.turnEnded === undefined ? {} : { turnEnded: parts.turnEnded }),
    ...(parts.reported === undefined ? {} : { reported: parts.reported }),
    ...(parts.skillsContext === undefined ? {} : { skillsContext: parts.skillsContext }),
    ...(parts.recall === undefined ? {} : { recall: parts.recall }),
    ...(parts.contextImages === undefined ? {} : { contextImages: parts.contextImages }),
    ...(askTools.length === 0 ? {} : { askTools }),
  });
}
