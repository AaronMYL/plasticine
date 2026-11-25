import { Value } from 'typebox/value';
import { DEVICE_RESULT_SCHEMAS, DeviceActionParamsSchema, type DeviceActionParams,
  type DeviceFailureCode, type NodeActionResultRequest, type NodeWireAction } from '../../../agent/shared/api/index.ts';
import type { DeviceServiceStatus } from '../../../agent/shared/api/desktop-bridge.ts';
import type { DeviceActionKind, DeviceLimits } from '../../../agent/shared/state.ts';
import { HelperCallError } from '../../../agent/shared/desktop-helper-client.ts';
import { HELPER_DEVICE_KINDS } from '../../../agent/shared/desktop-helper-protocol.ts';
import { HelperUnavailable, type HelperProcess } from '../helper/helper-process.ts';
import { actionLimitMs, actionRetryable } from '../../../agent/shared/device-action-limits.ts';
import { DESK_MAC_KINDS, DESK_SHELL_KINDS, runDeskAction, type DeskPort } from './desk-actions.ts';
import { runDeviceAction, SHELL_DEVICE_KINDS } from './device-executors.ts';
import type { DeviceGuard } from './device-guard.ts';
import type { ActionRunner } from './node-service.ts';
import { PathRefused, type PathSystem } from './path-policy.ts';

export class TabActionError extends Error {
  readonly code: DeviceFailureCode | null;
  readonly result: Record<string, unknown> | undefined;
  constructor(code: DeviceFailureCode | null, message: string, result?: Record<string, unknown>) {
    super(message);
    this.code = code;
    this.result = result;
  }
}

export class DeviceRefused extends Error {}

export type StepReporter = (step: string) => void;

export interface TabActionPort {
  available(): boolean;
  run(action: DeviceActionParams, step?: StepReporter): Promise<Record<string, unknown>>;
}

class ActionAbandoned extends Error {
  readonly cancelled: boolean;
  readonly step: string;
  readonly afterMs: number;
  constructor(cancelled: boolean, step: string, afterMs: number) {
    super(cancelled ? 'cancelled' : 'timed out');
    this.cancelled = cancelled;
    this.step = step;
    this.afterMs = afterMs;
  }
}

export interface ActionRunnerDeps {
  desk: DeskPort;
  keepAwake?: () => () => void;
  helper: HelperProcess;
  tabs: TabActionPort;
  guard: DeviceGuard;
  paths: PathSystem;
  localRoots(): readonly string[];
  confirm(message: string): Promise<boolean>;
  openExternal(url: string): Promise<void>;
  trash(path: string): Promise<void>;
  readUrl(url: string): Promise<{ text: string; truncated: boolean }>;
  now(): Date;
  log(line: string): void;
  limitMs?: (kind: DeviceActionKind, params: Record<string, unknown>) => number;
}

const TAB_KINDS = new Set<DeviceActionKind>(['tab_list', 'tab_read', 'tab_open', 'tab_navigate', 'tab_click',
  'tab_fill', 'tab_perceive', 'tab_act', 'tab_shot', 'tab_point', 'tab_type', 'tab_close', 'tab_wait', 'tab_key',
  'tab_scroll', 'tab_paste', 'tab_show', 'tab_upload', 'tab_hover', 'tab_drag', 'tab_downloads', 'tab_dialog']);

function refused(error: string): NodeActionResultRequest {
  return { status: 'refused', refusalLayer: 'device', error };
}

function failed(error: string, errorCode?: DeviceFailureCode, result?: Record<string, unknown>):
  NodeActionResultRequest {
  return { status: 'failed', error, ...(errorCode === undefined ? {} : { errorCode }),
    ...(result === undefined ? {} : { result }) };
}

export class DeviceActionRunner implements ActionRunner {
  private readonly deps: ActionRunnerDeps;

  constructor(deps: ActionRunnerDeps) {
    this.deps = deps;
  }

  async capabilities(): Promise<DeviceActionKind[]> {
    const fromHelper = await this.deps.helper.capabilities();
    const kinds: DeviceActionKind[] = ['browser_open', 'browser_read', 'app_open', ...fromHelper,
      ...DESK_SHELL_KINDS, ...(this.deps.paths.platform === 'darwin' ? DESK_MAC_KINDS : [])];
    if (fromHelper.includes('file_list')) {
      kinds.push('file_delete', 'file_fetch', 'file_put');
    }
    if (this.deps.tabs.available()) {
      kinds.push(...TAB_KINDS);
    }
    return kinds;
  }

  async missing(): Promise<DeviceServiceStatus['missing']> {
    const status = await this.deps.helper.permissions();
    if (status === null) {
      return [];
    }
    const missing: DeviceServiceStatus['missing'] = [];
    if (!status.screen) { missing.push('screen'); }
    if (!status.accessibility) { missing.push('accessibility'); }
    if (status.calendar !== 'granted') { missing.push('calendar'); }
    if (status.reminders !== 'granted') { missing.push('reminders'); }
    return missing;
  }

  async execute(wire: NodeWireAction, limits: DeviceLimits, progress: StepReporter = () => undefined,
    cancel?: AbortSignal): Promise<NodeActionResultRequest> {
    const candidate: unknown = { ...wire.params, kind: wire.kind };
    if (!Value.Check(DeviceActionParamsSchema, candidate)) {
      return refused('这一步的参数不全或不对，设备不替本体补判断。');
    }
    const action = candidate;
    if (Date.parse(wire.deadline) < this.deps.now().getTime()) {
      return failed('领到时已经过了这一步的期限，没做。');
    }
    const decision = this.deps.guard.decide(action, limits);
    if (decision.kind === 'refuse') {
      return refused(decision.reason);
    }
    if (decision.kind === 'confirm') {
      progress('等你在这台电脑上点「做」');
      if (!await this.deps.confirm(decision.reason)) {
        return refused('你在这台电脑上点了「不做」。');
      }
    }
    let result: Record<string, unknown>;
    const awake = this.deps.keepAwake?.();
    try {
      result = await this.limited(action, limits, progress, cancel);
    } catch (error) {
      return this.failure(error, action.kind);
    } finally {
      awake?.();
    }
    this.deps.guard.record(action);
    if (!Value.Check(DEVICE_RESULT_SCHEMAS[action.kind], result)) {
      this.deps.log(`${action.kind} 的结果形状不对，按没做成报。`);
      return failed('这台电脑做完了，但结果的形状不对，结果待核实。');
    }
    return { status: 'executed', result };
  }

  private limited(action: DeviceActionParams, limits: DeviceLimits, progress: StepReporter,
    cancel: AbortSignal | undefined): Promise<Record<string, unknown>> {
    const started = this.deps.now().getTime();
    let step = '开始做';
    const report: StepReporter = (next) => {
      step = next;
      progress(next);
    };
    report('开始做');
    const limitMs = (this.deps.limitMs ?? actionLimitMs)(action.kind, action as unknown as Record<string, unknown>);
    return new Promise((resolve, reject) => {
      const give = (cancelled: boolean): void => {
        clearTimeout(timer);
        reject(new ActionAbandoned(cancelled, step, this.deps.now().getTime() - started));
      };
      const timer = setTimeout(() => give(false), limitMs);
      const onCancel = (): void => give(true);
      cancel?.addEventListener('abort', onCancel, { once: true });
      this.run(action, limits, report).then((value) => {
        clearTimeout(timer);
        cancel?.removeEventListener('abort', onCancel);
        resolve(value);
      }, (error: unknown) => {
        clearTimeout(timer);
        cancel?.removeEventListener('abort', onCancel);
        reject(error);
      });
    });
  }

  private async run(action: DeviceActionParams, limits: DeviceLimits, step: StepReporter)
    : Promise<Record<string, unknown>> {
    const desk = await runDeskAction(action, { desk: this.deps.desk, paths: this.deps.paths,
      localRoots: this.deps.localRoots(), cloudRoots: limits.roots });
    if (desk !== null) {
      return desk;
    }
    if ((HELPER_DEVICE_KINDS as readonly string[]).includes(action.kind)
      || (SHELL_DEVICE_KINDS as readonly string[]).includes(action.kind)) {
      step((HELPER_DEVICE_KINDS as readonly string[]).includes(action.kind) ? '交给系统助手做' : '在这台电脑上做');
      const result = await runDeviceAction(action, { helper: this.deps.helper, paths: this.deps.paths,
        localRoots: this.deps.localRoots(), cloudRoots: limits.roots, trash: this.deps.trash });
      if (result !== null) {
        return result;
      }
    }
    if (TAB_KINDS.has(action.kind)) {
      return this.deps.tabs.run(action, step);
    }
    if (action.kind === 'browser_open') {
      await this.deps.openExternal(action.url);
      return {};
    }
    if (action.kind === 'browser_read') {
      return this.deps.readUrl(action.url);
    }
    throw new HelperUnavailable('这台电脑不会做这一步（是 iPhone 的事）。');
  }

  private failure(error: unknown, kind: DeviceActionKind): NodeActionResultRequest {
    if (error instanceof ActionAbandoned) {
      const seconds = Math.round(error.afterMs / 1000);
      if (error.cancelled) {
        this.deps.log(`设备动作 ${kind} 被取消：做到「${error.step}」，${seconds} 秒`);
        return { ...failed(`取消了：做到「${error.step}」时放下了，结果待核实。`, 'cancelled') };
      }
      const retryable = actionRetryable(kind);
      this.deps.log(`设备动作 ${kind} 超时：卡在「${error.step}」，${seconds} 秒`);
      return { ...failed(`做了 ${seconds} 秒还没做完，卡在「${error.step}」，已经放下；`
        + (retryable ? '这一步只读，可以直接再做。' : '先核实做没做成，再决定要不要再做。'), 'timed_out'),
      timedOut: { step: error.step, afterMs: error.afterMs, retryable } };
    }
    if (error instanceof PathRefused || error instanceof DeviceRefused) {
      return refused(error.message);
    }
    if (error instanceof HelperUnavailable) {
      return failed(error.message);
    }
    if (error instanceof HelperCallError) {
      if (error.code === 'refused' || error.code === 'permission_denied') {
        return refused(error.message);
      }
      return failed(error.message, error.code === 'screenshot_stale' ? 'screenshot_stale' : undefined);
    }
    if (error instanceof TabActionError) {
      return failed(error.message, error.code ?? undefined, error.result);
    }
    this.deps.log(`设备动作出错：${error instanceof Error ? error.stack ?? error.message : String(error)}`);
    return failed(`这台电脑做这一步时出错了：${error instanceof Error ? error.message : String(error)}`);
  }
}
