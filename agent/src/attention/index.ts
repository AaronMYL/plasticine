// attention/: 注意力与渠道（《应用架构方案》第 3 节）。四档渠道、要你定卡的出卡 / 作答 / 先不 / 撤回、「等你」的
// 先后，和「立刻打断」的 Web Push、主线通知（主线一条消息 + 系统通知，不再发通知邮件）、项目逾期与停滞的查看。它不调模型；卡被答之后的后果由出卡的那一方注入（AskResolver）。

export { AskDesk } from './asks.ts';
export type {
  AfterCommit,
  AnsweredAsk,
  AnswerAttempt,
  Answerer,
  AnswerInput,
  AskDeskState,
  AskOptionInput,
  AskResolver,
  RaiseAsk,
} from './asks.ts';
export { Changes } from './changes.ts';
export type { AskChange } from './changes.ts';
export { channelForAsk, pushes, showsCard } from './channels.ts';
export type { AskChannel } from './channels.ts';
export { AttentionError, ATTENTION_ERROR_CODES } from './errors.ts';
export type { AttentionErrorCode } from './errors.ts';
export { compareAsks, compareWaiting, currentAsk } from './order.ts';
export type { WaitingEntry } from './order.ts';
export { Presenter } from './presenter.ts';
export type { Notifier, PresentationSink } from './presenter.ts';
export { Notices } from './notices.ts';
export type { NoticeInput, NoticePoster, NoticesOptions } from './notices.ts';
export { ProjectWatch, STALL_DAYS } from './project-watch.ts';
export { fetchTransport, payloadFor, PUSH_BODY, PUSH_TIMEOUT_MS, PUSH_TTL_SECONDS, PushService } from './push.ts';
export type { PushRequest, PushServiceOptions, PushTransport } from './push.ts';
export { loadOrCreateVapidKeys, VAPID_KEY_FILE } from './vapid.ts';
export { encryptPayload, generateVapidKeys, vapidAuthorization, VAPID_TOKEN_TTL_MS } from './web-push-crypto.ts';
export type { EncryptionSeed, SubscriberKeys, VapidKeys } from './web-push-crypto.ts';
// 按卡的来路分派作答、外环的定时扫描。
export { routeAsks } from './ask-routing.ts';
export { SCAN_TICK_MS, ScanScheduler } from './scheduler.ts';
export type { Scan, ScanResult } from './scheduler.ts';
