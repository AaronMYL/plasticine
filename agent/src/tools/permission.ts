import type { Tool } from './registry.ts';

export interface PermissionRequest {
  actionId?: string;
  tool: Tool;
  args: Record<string, unknown>;
  runId: string;
  /** The call's cancel signal: a check that waits on something must stop waiting when it fires. */
  signal: AbortSignal;
}

export type PermissionDecision = { allowed: true } | { allowed: false; message: string };

export interface PermissionGate {
  check(request: PermissionRequest): Promise<PermissionDecision>;
}

export const autoOnlyPermissionGate: PermissionGate = {
  async check({ tool }) {
    if (tool.permission === 'auto') {
      return { allowed: true };
    }
    const needs = tool.permission === 'agreement' ? '有生效的约定覆盖' : '用户这一次明确确认';
    return { allowed: false, message: `需要授权：「${tool.label}」要${needs}才能执行，这次没有执行。` };
  },
};
