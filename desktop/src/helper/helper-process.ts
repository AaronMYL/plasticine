import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import { HelperCallError, HelperClient, type HelperCallOptions } from '../../../agent/shared/desktop-helper-client.ts';
import { helperCapabilities, type HelperDeviceKind, type HelperMethod, type HelperParams,
  type HelperResult } from '../../../agent/shared/desktop-helper-protocol.ts';

const CALL_TIMEOUT_MS = 60_000;
const COMMAND_TIMEOUT_MS = 130_000;
const REQUEST_TIMEOUT_MS = 5 * 60_000;

export class HelperUnavailable extends Error {}

export interface HelperProcessDeps {
  spawn(): ChildProcessWithoutNullStreams;
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

  async methods(): Promise<readonly string[]> {
    try {
      return (await this.start().ready).methods;
    } catch (error) {
      this.note(error);
      return [];
    }
  }

  async permissions(): Promise<HelperResult<'permissions.status'> | null> {
    try {
      return await this.call('permissions.status', {});
    } catch (error) {
      this.note(error);
      return null;
    }
  }

  async capabilities(): Promise<HelperDeviceKind[]> {
    const status = await this.permissions();
    return status === null ? [] : helperCapabilities(status, await this.methods());
  }

  async configure(): Promise<void> {
    if (this.running !== null) {
      await this.call('helper.configure', { roots: [...this.deps.roots()] });
    }
  }

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
