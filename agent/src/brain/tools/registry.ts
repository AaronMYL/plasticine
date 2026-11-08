// The tool registry (harness design 10-27 §5.2, borrowed from hermes: duplicates are refused at registration).
// A definition that breaks a rule fails here, at start-up, instead of misbehaving in the middle of a turn.
// 2026-11-05 Harness 重做：旧的对话轮、任务轮没了，注册表只是新内核取业务工具的地方（app/assemble-lines.ts 按名字取、
// lines/legacy.ts 包成 pi 的工具）；工具组开关（gate）照旧生效。

import type { Static, TSchema } from 'typebox';
import { Value } from 'typebox/value';
import type { ToolDefinition, ModelImage } from '../../../shared/model.ts';
import {
  DEFAULT_MAX_RESULT_CHARS,
  ToolDescriptorSchema,
  type ToolDescriptor,
  type ToolRole,
} from '../../../shared/tools.ts';

/** What a running tool gets: only module interfaces are reached through it, never the database. */
export interface ToolContext {
  /** Aborts on cancel and on the tool's own timeout; a tool that ignores it is no longer waited for. */
  signal: AbortSignal;
  runId: string;
  callId: string;
  /** The call's stable action id: the line and the tool call (lines/legacy.ts). */
  actionId: string | null;
  now: () => Date;
  /** Actual visual output, carried separately from text into the model's image input. */
  emitImage?: (image: ModelImage) => void;
}

/** What a tool file writes. `parallel` defaults to false (same as Claude Code for custom tools, §5.2). */
export interface ToolSpec<P extends TSchema> {
  name: string;
  label: string;
  description: string;
  replay: ToolDescriptor['replay'];
  effect: ToolDescriptor['effect'];
  parallel?: boolean;
  permission: ToolDescriptor['permission'];
  roles: ToolRole[];
  timeoutMs: number;
  maxResultChars?: number;
  parameters: P;
  execute(args: Static<P>, context: ToolContext): Promise<string>;
}

/** A tool as the registry and dispatcher see it: defaults filled in, arguments checked again on the way in. */
export interface Tool extends Omit<ToolDescriptor, 'parameters'> {
  parameters: TSchema;
  execute(args: unknown, context: ToolContext): Promise<string>;
}

export function defineTool<P extends TSchema>(spec: ToolSpec<P>): Tool {
  const { execute, parallel, maxResultChars, ...rest } = spec;
  return {
    ...rest,
    parallel: parallel ?? false,
    maxResultChars: maxResultChars ?? DEFAULT_MAX_RESULT_CHARS,
    execute(args, context) {
      // dispatch.ts validates first and reports the errors to the model; this only stops a direct caller from
      // handing unchecked input to the tool.
      if (!Value.Check(spec.parameters, args)) {
        return Promise.reject(new Error(`工具「${spec.name}」收到没有通过校验的参数`));
      }
      return execute(args, context);
    },
  };
}

/** The parameters as plain JSON: typebox's own marker properties are not enumerable and drop out here. */
function plainParameters(tool: Tool): unknown {
  return JSON.parse(JSON.stringify(tool.parameters ?? null));
}

function describe(tool: Tool): ToolDescriptor {
  const draft = {
    name: tool.name,
    label: tool.label,
    description: tool.description,
    parameters: plainParameters(tool),
    replay: tool.replay,
    effect: tool.effect,
    parallel: tool.parallel,
    permission: tool.permission,
    roles: tool.roles,
    timeoutMs: tool.timeoutMs,
    maxResultChars: tool.maxResultChars,
  };
  if (!Value.Check(ToolDescriptorSchema, draft)) {
    const first = Value.Errors(ToolDescriptorSchema, draft)[0];
    const where = first === undefined ? '' : `${first.instancePath} ${first.message}`;
    const hint = first?.instancePath.startsWith('/parameters') === true ? '（参数 schema 必须是 object）' : '';
    throw new Error(`工具「${tool.name}」的定义不合格式：${where}${hint}`);
  }
  return draft;
}

function checkRules(descriptor: ToolDescriptor, execute: unknown): void {
  const { name } = descriptor;
  if (typeof execute !== 'function') {
    throw new Error(`工具「${name}」没有执行函数`);
  }
  // Only reads may overlap; writes and interactions stay in order (§5.2 第 2 步).
  if (descriptor.parallel && descriptor.effect !== 'read') {
    throw new Error(`工具「${name}」的 effect 是 ${descriptor.effect}，只有 read 类工具可以 parallel`);
  }
  // Independent verification gets read tools and evidence reads only (§5.2 roles, decision 77).
  if (descriptor.roles.includes('verifier') && descriptor.effect !== 'read') {
    throw new Error(`工具「${name}」会写东西，不能给 verifier 用`);
  }
}

/** Whether a registered tool is switched on (工具组, M5); a tool the gate turns off is not offered at all. */
export type ToolGate = (name: string) => boolean;


export class ToolRegistry {
  #tools = new Map<string, { tool: Tool; descriptor: ToolDescriptor }>();
  #gate: ToolGate = () => true;

  /** The switch is read on every turn, so a change takes effect from the next model request on. */
  setGate(gate: ToolGate): void {
    this.#gate = gate;
  }

  register(tool: Tool): void {
    if (tool.parameters === undefined) {
      throw new Error(`工具「${tool.name}」没有定义参数 schema`);
    }
    const descriptor = describe(tool);
    checkRules(descriptor, tool.execute);
    if (this.#tools.has(descriptor.name)) {
      throw new Error(`工具「${descriptor.name}」已注册，名字不能重复`);
    }
    this.#tools.set(descriptor.name, { tool, descriptor });
  }

  get(name: string): Tool | undefined {
    return this.#tools.get(name)?.tool;
  }

  /** Whether a turn with this role is offered the tool; a call to a tool it was not offered is an unknown tool. */
  isOffered(name: string, role: ToolRole): boolean {
    return (this.#tools.get(name)?.descriptor.roles.includes(role) ?? false) && this.#gate(name);
  }

  /** In registration order, so the model sees a stable list and its prompt cache holds. */
  forRole(role: ToolRole): Tool[] {
    return this.#offered(role).map((entry) => entry.tool);
  }

  descriptors(role: ToolRole): ToolDescriptor[] {
    return this.#offered(role).map((entry) => entry.descriptor);
  }

  definitionsFor(role: ToolRole): ToolDefinition[] {
    return this.descriptors(role).map((descriptor) => ({
      name: descriptor.name,
      description: descriptor.description,
      parameters: descriptor.parameters,
    }));
  }

  #offered(role: ToolRole): { tool: Tool; descriptor: ToolDescriptor }[] {
    return [...this.#tools.values()].filter((entry) => {
      return entry.descriptor.roles.includes(role) && this.#gate(entry.descriptor.name);
    });
  }
}
