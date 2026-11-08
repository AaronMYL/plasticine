// calendar/ 的测试用：一台报了日历能力的 Mac、一个按种类回执的假设备通道。

import type { DeviceActionParams } from '../../shared/api/index.ts';
import type { DeviceActionKind, NodeInput } from '../../shared/state.ts';
import type { ActionOutcome, ActionRequest } from '../../src/devices/index.ts';
import type { StateService } from '../../src/state/index.ts';

export function mac(state: StateService, lastSeenAt: string, capabilities: DeviceActionKind[] = ['calendar_list',
  'calendar_create', 'reminder_list', 'reminder_create', 'reminder_complete']): string {
  const input: NodeInput = { name: '家里的 Mac', platform: 'macos', appVersion: '0.9.0', protocolVersion: 1,
    capabilities, credentialHash: 'a'.repeat(64), pairingCodeId: 'code-1', pairedAt: lastSeenAt, lastSeenAt };
  return state.nodes.create(input).id;
}

export class FakeDevices {
  readonly requests: ActionRequest[] = [];
  answer: (action: DeviceActionParams) => Pick<ActionOutcome, 'status' | 'result'> & Partial<ActionOutcome>
    = () => ({ status: 'executed', result: {} });

  perform(request: ActionRequest): Promise<ActionOutcome> {
    this.requests.push(request);
    const answer = this.answer(request.action);
    return Promise.resolve({ actionId: request.actionId, refusalLayer: null, reason: null, reused: false,
      ...answer });
  }

  kinds(): string[] {
    return this.requests.map((request) => request.action.kind);
  }
}
