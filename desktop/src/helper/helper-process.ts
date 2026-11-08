// 壳这一头的系统助手进程（Mac：mac/ 的 plasticine-helper，machelper 线；Windows：desktop/helpers/windows 的
// PlasticineHelper.exe）。协议和调用器是两端共用的 agent/shared/desktop-helper-protocol.ts、desktop-helper-client.ts：
// 这里只管进程——第一次要用时拉起（作为壳 App 的附属可执行文件，系统权限记在壳名下），先把授权目录告诉它
// （helper.configure），stdout 交给调用器、退出了让在路上的调用按「说不清做没做」交回，下一次要用时再拉起。

import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import { HelperCallError, HelperClient, type HelperCallOptions } from '../../../agent/shared/desktop-helper-client.ts';
import { helperCapabilities, type HelperDeviceKind, type HelperMethod, type HelperParams,
  type HelperResult } from '../../../agent/shared/desktop-helper-protocol.ts';

/** 一般调用多久没回执就放弃（并让助手取消）。 */
const CALL_TIMEOUT_MS = 60_000;
/** 命令按助手默认的 120 秒，再给 10 秒收尾。 */
const COMMAND_TIMEOUT_MS = 130_000;
/** 弹系统授权框要等他点，给五分钟。 */
const REQUEST_TIMEOUT_MS = 5 * 60_000;

/** 这个安装包没带助手（开发机、Linux），或者拉不起来。 */
export class HelperUnavailable extends Error {}

export interface HelperProcessDeps {
  spawn(): ChildProcessWithoutNullStreams;
  /** 本机授权目录（设置里的）。 */
  roots(): readonly string[];
  log(line: string): void;
}

interface Running {
  client: HelperClient;
  child: ChildProcessWithoutNullStreams;
  ready: Promise<HelperResult<'helper.info'>>;
}

function timeoutFor(method: HelperMethod): number {
  if (method === 'command.run') {
    return COMMAND_TIMEOUT_MS;
  }
  return method === 'permissions.request' ? REQUEST_TIMEOUT_MS : CALL_TIMEOUT_MS;
}

export class HelperProcess {
  private readonly deps: HelperProcessDeps;
  private running: Running | null = null;

  constructor(deps: HelperProcessDeps) {
    this.deps = deps;
  }

  async call<M extends HelperMethod>(method: M, params: HelperParams<M>,
    options: HelperCallOptions = {}): Promise<HelperResult<M>> {
    const running = this.start();
    await running.ready;
    return running.client.call(method, params, { timeoutMs: timeoutFor(method), ...options });
  }

  /** 助手会的方法；没有助手就是空的。 */
  async methods(): Promise<readonly string[]> {
    try {
      return (await this.start().ready).methods;
    } catch (error) {
      this.note(error);
      return [];
    }
  }

  /** 系统权限；没有助手是 null。 */
  async permissions(): Promise<HelperResult<'permissions.status'> | null> {
    try {
      return await this.call('permissions.status', {});
    } catch (error) {
      this.note(error);
      return null;
    }
  }

  /** 按系统权限算 hello 里该报的助手能力（helperCapabilities，和助手同一份规则）。 */
  async capabilities(): Promise<HelperDeviceKind[]> {
    const status = await this.permissions();
    return status === null ? [] : helperCapabilities(status);
  }

  /** 授权目录改了：告诉正在跑的助手（没在跑的下次拉起时会先配置）。 */
  async configure(): Promise<void> {
    if (this.running !== null) {
      await this.call('helper.configure', { roots: [...this.deps.roots()] });
    }
  }

  /** 退出壳时调：关 stdin，助手取消在做的、最多等 2 秒退出。 */
  stop(): void {
    const running = this.running;
    this.running = null;
    running?.child.stdin.end();
  }

  private start(): Running {
    if (this.running !== null) {
      return this.running;
    }
    let child: ChildProcessWithoutNullStreams;
    try {
      child = this.deps.spawn();
    } catch (error) {
      throw error instanceof HelperUnavailable ? error
        : new HelperUnavailable(`助手拉不起来：${error instanceof Error ? error.message : String(error)}`);
    }
    const client = new HelperClient((line) => child.stdin.write(line));
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => client.receive(chunk));
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk: string) => this.deps.log(`助手：${chunk.trimEnd()}`));
    const ended = (reason: string): void => {
      client.close(reason);
      if (this.running?.child === child) {
        this.running = null;
      }
    };
    child.on('error', (error) => ended(`助手拉不起来：${error.message}`));
    child.on('exit', (code) => ended(`助手退出了（${code ?? '信号'}），这一步说不清做没做，请先核实。`));
    const ready = (async () => {
      const info = await client.call('helper.info', {}, { timeoutMs: CALL_TIMEOUT_MS });
      if (info.methods.includes('helper.configure')) {
        await client.call('helper.configure', { roots: [...this.deps.roots()] }, { timeoutMs: CALL_TIMEOUT_MS });
      }
      return info;
    })();
    ready.catch(() => undefined);
    const running: Running = { client, child, ready };
    this.running = running;
    return running;
  }

  private note(error: unknown): void {
    if (error instanceof HelperUnavailable || error instanceof HelperCallError) {
      this.deps.log(`助手：${error.message}`);
      return;
    }
    throw error;
  }
}
