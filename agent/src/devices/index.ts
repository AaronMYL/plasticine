// devices/：设备服务的云端一侧（《应用架构方案》第 4、8、10 节，M5）。执行节点的配对、长期凭证（只存散列）、报到、撤销、
// 设备侧上限（用户确认字段）、受保护路径，以及每个设备动作：先落盘再发、同一 action_id 不重做、超上限一律当场拒。
// 它不调模型，不规划；默认经长轮询 NodeTransport 发动作，测试可注入假节点。

export { ACTION_TTL_MS, DeviceActions, IDLE_SINK, IOS_ACTION_TTL_MS } from './actions.ts';
export { inputLeaseHolder, nodeOnline, OFFLINE_QUEUE_KINDS, queuesUntilOnline, userActive } from './holds.ts';
export type { DeviceHold, DeviceWaitReason } from './holds.ts';
export { classifyLane, DEVICE_LANES, isPaymentPage } from './lanes.ts';
export type { DeviceLane, LaneDecision } from './lanes.ts';
export { proveDeviceAction } from './proof.ts';
export { PAGE_SUBMIT_CONTEXT_KEY, PageSubmitContextSchema, submitHoldForRun, submitRefusal, tabTrace }
  from './page-submits.ts';
export type { PageSubmitContext, SubmitHold, TabTrace } from './page-submits.ts';
export { BROWSE_KINDS, choosePlace, DEVICE_PLACES, PLACE_REASONS } from './route.ts';
export type { DevicePlace, PlaceChoice } from './route.ts';
export { DEVICE_IMAGE_MAX_CHARS, splitDeviceImage } from './device-images.ts';
export type { SplitImage } from './device-images.ts';
export type { ActionOutcome, ActionRequest, DeviceSink } from './actions.ts';
export { NODE_CODE_TTL_MS } from './credentials.ts';
export { DEFAULT_DEVICE_LIMITS, PROTECTED_DEVICE_PATHS } from './defaults.ts';
export { DEVICE_ERROR_CODES, DeviceError } from './errors.ts';
export type { DeviceErrorCode } from './errors.ts';
export { checkAction, factsOf } from './limits.ts';
export type { Refusal } from './limits.ts';
export { effectiveLimits } from './pairing.ts';
export type { IssuedNodeCode, PairedNode } from './pairing.ts';
export { globMatcher, normalizeDevicePath, protectedRule } from './paths.ts';
export { DeviceService } from './service.ts';
export type { ApprovedResult } from './approvals.ts';
export type { DeviceServiceOptions } from './service.ts';
export { PollingNodeTransport, TransportError, UNCONNECTED_TRANSPORT } from './transport.ts';
export type { NodeTransport } from './transport.ts';
