// 一个设备动作从领到到回执：补回 kind 校验参数 → 过期限 → 设备这道墙（device-guard）→ 要问的弹原生确认（默认「不做」）
// → 交给助手 / 网页标签 / 壳自己做 → 结果按共享 schema 核一遍。出错写进回执，不往外抛：失败的种类（截图过期、
// 他正看着、提交没放行、编号过期）原样报给本体，由本体决定重截、等他、出卡还是重新感知。

import { Value } from 'typebox/value';
import { DEVICE_RESULT_SCHEMAS, DeviceActionParamsSchema, type DeviceActionParams,
  type DeviceFailureCode, type NodeActionResultRequest, type NodeWireAction } from '../../../agent/shared/api/index.ts';
import type { DeviceServiceStatus } from '../../../agent/shared/api/desktop-bridge.ts';
import type { DeviceActionKind, DeviceLimits } from '../../../agent/shared/state.ts';
import { HelperCallError } from '../../../agent/shared/desktop-helper-client.ts';
import { HELPER_DEVICE_KINDS } from '../../../agent/shared/desktop-helper-protocol.ts';
import { HelperUnavailable, type HelperProcess } from '../helper/helper-process.ts';
import { runDeviceAction, SHELL_DEVICE_KINDS } from './device-executors.ts';
import type { DeviceGuard } from './device-guard.ts';
import type { ActionRunner } from './node-service.ts';
import { PathRefused, type PathSystem } from './path-policy.ts';

/** 网页标签动作没做成时带的失败种类（和 node-channel.ts 的 DEVICE_FAILURE_CODES 对上）。 */
export class TabActionError extends Error {
  readonly code: DeviceFailureCode | null;
  readonly result: Record<string, unknown> | undefined;
  constructor(code: DeviceFailureCode | null, message: string, result?: Record<string, unknown>) {
    super(message);
    this.code = code;
    this.result = result;
  }
}

/** 设备这道墙在执行时（找到元素、看到真实页面以后）拒了：回 refused，不是失败。 */
export class DeviceRefused extends Error {}

export interface TabActionPort {
  available(): boolean;
  run(action: DeviceActionParams): Promise<Record<string, unknown>>;
}

export interface ActionRunnerDeps {
  helper: HelperProcess;
  tabs: TabActionPort;
  guard: DeviceGuard;
  paths: PathSystem;
  localRoots(): readonly string[];
  /** 弹原生确认框：他点「做」才是 true（默认按钮是「不做」）。 */
  confirm(message: string): Promise<boolean>;
  openExternal(url: string): Promise<void>;
  /** 挪进废纸篓 / 回收站。 */
  trash(path: string): Promise<void>;
  /** 读一个网址的文字（HTML 保留标记），最多 200 KiB；不是已登录浏览器的 DOM。 */
  readUrl(url: string): Promise<{ text: string; truncated: boolean }>;
  now(): Date;
  log(line: string): void;
}

const TAB_KINDS = new Set<DeviceActionKind>(['tab_list', 'tab_read', 'tab_open', 'tab_navigate', 'tab_click',
  'tab_fill', 'tab_perceive', 'tab_act']);

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

  /** hello 里报的能力：助手按系统权限报的（helperCapabilities）+ 壳自己会的（浏览器、网页标签、删除、打开应用）。 */
  async capabilities(): Promise<DeviceActionKind[]> {
    const fromHelper = await this.deps.helper.capabilities();
    const kinds: DeviceActionKind[] = ['browser_open', 'browser_read', 'app_open', ...fromHelper];
    if (fromHelper.includes('file_list')) {
      kinds.push('file_delete');
    }
    if (this.deps.tabs.available()) {
      kinds.push(...TAB_KINDS);
    }
    return kinds;
  }

  /** 系统权限没给的几样（设置页列出来，点了打开系统设置）。 */
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

  async execute(wire: NodeWireAction, limits: DeviceLimits): Promise<NodeActionResultRequest> {
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
    if (decision.kind === 'confirm' && !await this.deps.confirm(decision.reason)) {
      return refused('你在这台电脑上点了「不做」。');
    }
    let result: Record<string, unknown>;
    try {
      result = await this.run(action, limits);
    } catch (error) {
      return this.failure(error);
    }
    this.deps.guard.record(action);
    if (!Value.Check(DEVICE_RESULT_SCHEMAS[action.kind], result)) {
      this.deps.log(`${action.kind} 的结果形状不对，按没做成报。`);
      return failed('这台电脑做完了，但结果的形状不对，结果待核实。');
    }
    return { status: 'executed', result };
  }

  private async run(action: DeviceActionParams, limits: DeviceLimits): Promise<Record<string, unknown>> {
    if ((HELPER_DEVICE_KINDS as readonly string[]).includes(action.kind)
      || (SHELL_DEVICE_KINDS as readonly string[]).includes(action.kind)) {
      const result = await runDeviceAction(action, { helper: this.deps.helper, paths: this.deps.paths,
        localRoots: this.deps.localRoots(), cloudRoots: limits.roots, trash: this.deps.trash });
      if (result !== null) {
        return result;
      }
    }
    if (TAB_KINDS.has(action.kind)) {
      return this.deps.tabs.run(action);
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

  private failure(error: unknown): NodeActionResultRequest {
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
