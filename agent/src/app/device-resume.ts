import type { DeviceWait } from '../devices/index.ts';
import type { StateService } from '../state/index.ts';
import { errorCategory, safeLog } from '../util/index.ts';
import type { LineKernel } from '../lines/index.ts';

export function deviceBackText(nodeName: string, wait: DeviceWait, at: string): string {
  const time = new Date(at).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false,
    timeZone: 'Asia/Shanghai' });
  return `「${nodeName}」${time} 回来了，动作通道空着。之前卡在：${wait.why}。接着做这件事：卡住的那一步只读的直接再做，`
    + '点、填、发、写的先核实做没做成（看页面或 device_logs），再从那一步往下做；不要另开任务。';
}

export function resumeAfterDevice(state: Pick<StateService, 'lines'>, kernel: () => Pick<LineKernel, 'send'>,
  waits: readonly DeviceWait[], nodeName: string, at: string): void {
  for (const wait of waits) {
    const line = state.lines.get(wait.lineId);
    if (line === undefined || line.archivedAt != null || line.pauseReason === 'stopped') {
      continue;
    }
    try {
      kernel().send(wait.lineId, { text: deviceBackText(nodeName, wait, at),
        origin: { kind: 'trigger', ref: `device-back:${wait.nodeId}` } });
    } catch (error) {
      safeLog('error', 'device_resume_failed', { objectId: wait.lineId, category: errorCategory(error) });
    }
  }
}
