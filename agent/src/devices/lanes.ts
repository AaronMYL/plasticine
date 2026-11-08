// 三条道的判法正文在 agent/shared/device-lanes.ts（桌面客户端在设备上用同一份）；这里照旧给 devices/ 里的人用。
export { classifyLane, DEVICE_LANES, isPaymentPage } from '../../shared/device-lanes.ts';
export type { DeviceLane, LaneDecision } from '../../shared/device-lanes.ts';
