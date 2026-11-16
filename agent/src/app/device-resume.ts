// 设备回来了，等它的任务接着做（11-16 Aaron 定：卡住、掉线的，设备一恢复就在原任务里从那一步接着做，不另开）。
// devices/device-waits.ts 记着哪些线在等哪台设备；设备重新报到（离线回来，或卡住后又空了）时，往每条线里说一句：
// 先核实卡住的那一步做没做成，再接着做。停止了、归档了、没了的线不说；Aaron 暂停着的，这句话排着，他继续时再做。

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
