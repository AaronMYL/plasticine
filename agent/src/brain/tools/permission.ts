// 工具执行前的权限门（harness 5.2 第 3 步）：设备动作先过设备的硬拒和上限（device-action.ts 的门），其余按工具
// 自己声明的 permission：auto 直接放行，agreement / approve 回一句「要授权」不执行。新内核的硬线另由 lines/ 管。

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
