// 设置里的开关「这台设备接收系统通知」（「立刻打断」档，第 91 条 ⑤）：
// - 打开：用户点了才申请通知权限（不在加载时弹）→ 注册 service worker、用服务端的 VAPID 公钥订阅 → 订阅交给
//   /v2/push/subscriptions。权限被拒、浏览器不支持时就地说清楚。
// - 关上：先在浏览器上退订（这台设备马上不再收），再告诉服务端；服务端那边没删掉也不要紧，它推送失败（404 / 410）
//   时会自己停用那一行（agent/src/attention/push.ts）。
// - 每次登录后（实时层建起来）已经开着的就把订阅再交一次：重新配对换了会话，服务端那边也接得上。
// 操作一次只走一个：进行中（checking / working）时开关不可点，新的点击不接；每个操作带一个代次，过期操作的回执
// 不再写状态（审查 88c54ec P2：重新登记还没回来时关掉开关，登记的回执后到又写回「开着」）。浏览器的每一步都包在
// 错误处理里：哪一步抛了都写原因、开关恢复可点，不留永远的「正在设置…」。实时层卸掉（401、重新配对）时 dispose 让进行中的
// 操作作废：每个异步步骤回来先看代次，作废了就不再订阅、不再登记（review-followups 912f540：旧实例等公钥时 401，重新
// 配对后旧请求回来仍去订阅登记）。

import type { PlasticineApi } from '../../api/client.ts';
import { errorText, isUncertain } from '../../api/errors.ts';
import type { DeviceSubscription, PushDevice, PushPermission } from '../../api/push-device.ts';
import { createRequestId } from '../../api/request-id.ts';
import { Store } from '../../state/store.ts';
import { hostNotify, inDesktopApp } from '../../shell/host.ts';
import { isDeferredStandaloneAsk, MAIN_THREAD_PATH, NOTICE_TITLE, PUSH_BODY, reportBrief,
  type LineMessageView } from '../../api/shared.ts';
import type { LiveEvent } from '../../api/types.ts';

/**
 * checking 正在看这台设备的订阅 · unsupported 浏览器不支持 · denied 权限被拒 · off 关着 · on 开着 ·
 * unregistered 这台设备订阅了但服务端还没收下（回执不确定或失败），可以再登记一次 · working 正在开 / 关。
 */
export type PushSwitchStatus =
  'checking' | 'unsupported' | 'denied' | 'off' | 'on' | 'unregistered' | 'working' | 'native';

export interface PushSwitchState {
  status: PushSwitchStatus;
  /** 给人看的一句：为什么不支持、怎么去允许、哪一步没成。 */
  message: string | null;
}

/** 主线上要弹 Mac 通知的那一句：系统通知是它自己带的一句，后台线结果只在没做成 / 没做完时弹；别的不弹。 */
export function mainLineBrief(message: LineMessageView): string | null {
  if (message.role === 'notice') return message.summary ?? null;
  if (message.role === 'lineReport') return reportBrief(message.stopReason);
  return null;
}

const DENIED_TEXT = '这个浏览器拒绝了 Plasticine 的通知。要在浏览器的网站设置里把「通知」改成允许，再回来打开。';
const DISMISSED_TEXT = '没有允许通知，开关保持关着。想收的时候再点一次。';

interface PendingRegistration {
  requestId: string;
  endpoint: string;
  p256dh: string;
  auth: string;
}

/** 进行中：这时开关不可点、新的点击不接。 */
export function isBusy(status: PushSwitchStatus): boolean {
  return status === 'checking' || status === 'working';
}

export class PushSwitch {
  readonly store = new Store<PushSwitchState>({ status: 'checking', message: null });
  private readonly api: PlasticineApi;
  private readonly device: PushDevice;
  /** 登记那一步回执不确定时留着：标识和那次登记的订阅内容绑在一起，同一份订阅再登记才用同一个 requestId。 */
  private pendingRequest: PendingRegistration | null = null;
  /** 每开始一个操作加一；回执回来时代次变了，就是过期操作，不写状态。 */
  private generation = 0;
  private readonly notified = new Set<string>();

  constructor(api: PlasticineApi, device: PushDevice) {
    this.api = api;
    this.device = device;
  }

  /** 看这台设备现在开没开；开着就把订阅再交一次（登录换过会话也接得上）。不弹权限框。 */
  async start(): Promise<void> {
    const generation = this.next('checking');
    if (inDesktopApp()) { this.settle(generation, 'native', null); return; }
    const reason = this.device.unsupportedReason();
    if (reason !== null) {
      this.settle(generation, 'unsupported', reason);
      return;
    }
    let subscription: DeviceSubscription | null;
    try {
      subscription = await this.device.current();
    } catch (cause) {
      this.settle(generation, 'off', `读不到这台设备的通知订阅：${errorText(cause)}`);
      return;
    }
    if (subscription === null) {
      const denied = this.device.permission() === 'denied';
      this.settle(generation, denied ? 'denied' : 'off', denied ? DENIED_TEXT : null);
      return;
    }
    if (this.stale(generation)) {
      return;
    }
    try {
      const status = await this.api.push.status();
      if (this.stale(generation)) {
        return;
      }
      if (status.subscribed) {
        this.settle(generation, 'on', null);
        return;
      }
    } catch (cause) {
      this.settle(generation, 'unregistered', `读不到服务端的订阅状态：${errorText(cause)}`);
      return;
    }
    await this.register(generation, subscription);
  }

  /** 用户点了开关（打开）：这时才申请权限。 */
  async enable(): Promise<void> {
    if (inDesktopApp()) { this.store.set({ status: 'native', message: null }); return; }
    if (isBusy(this.store.get().status)) {
      return;
    }
    const reason = this.device.unsupportedReason();
    if (reason !== null) {
      this.store.set({ status: 'unsupported', message: reason });
      return;
    }
    const generation = this.next('working');
    let permission: PushPermission;
    try {
      permission = this.device.permission() === 'granted' ? 'granted' : await this.device.requestPermission();
    } catch (cause) {
      this.settle(generation, 'off', `没申请到通知权限：${errorText(cause)}`);
      return;
    }
    if (permission !== 'granted') {
      const denied = permission === 'denied';
      this.settle(generation, denied ? 'denied' : 'off', denied ? DENIED_TEXT : DISMISSED_TEXT);
      return;
    }
    let subscription: DeviceSubscription;
    try {
      const { publicKey } = await this.api.push.key();
      if (this.stale(generation)) {
        return;
      }
      subscription = await this.device.subscribe(publicKey);
    } catch (cause) {
      this.settle(generation, 'off', `没订阅上：${errorText(cause)}`);
      return;
    }
    if (this.stale(generation)) {
      return;
    }
    await this.register(generation, subscription);
  }

  /** 订阅了、服务端还没收下：再登记一次（回执不确定过的用同一个 requestId）。 */
  async retry(): Promise<void> {
    if (isBusy(this.store.get().status)) {
      return;
    }
    const generation = this.next('working');
    let subscription: DeviceSubscription | null;
    try {
      subscription = await this.device.current();
    } catch (cause) {
      this.settle(generation, 'unregistered', `读不到这台设备的通知订阅：${errorText(cause)}`);
      return;
    }
    if (subscription === null) {
      // 浏览器那边的订阅没了：从头打开一次（enable 自己起新的代次）。
      this.settle(generation, 'off', null);
      if (!this.stale(generation)) {
        await this.enable();
      }
      return;
    }
    if (this.stale(generation)) {
      return;
    }
    await this.register(generation, subscription);
  }

  /** 用户点了开关（关上）。 */
  async disable(): Promise<void> {
    if (inDesktopApp()) { return; }
    if (isBusy(this.store.get().status)) {
      return;
    }
    const generation = this.next('working');
    let subscription: DeviceSubscription | null;
    try {
      subscription = await this.device.current();
      await subscription?.unsubscribe();
    } catch (cause) {
      this.settle(generation, 'on', `这台设备没退订成：${errorText(cause)}`);
      return;
    }
    this.pendingRequest = null;
    if (subscription === null) {
      this.settle(generation, 'off', null);
      return;
    }
    try {
      await this.api.push.unsubscribe({ requestId: createRequestId(), endpoint: subscription.endpoint });
      this.settle(generation, 'off', null);
    } catch (cause) {
      const reason = errorText(cause);
      const message = `这台设备已经不再接收；服务端那条登记没删掉（${reason}）它下次推送失败时会自己停用。`;
      this.settle(generation, 'off', message);
    }
  }

  /** 实时层卸掉时调：进行中的操作作废（之后的 start 照常起新的代次）。 */
  dispose(): void {
    this.generation += 1;
  }

  /**
   * Mac App 自己弹系统通知（网页推送在服务端发）：立刻打断的卡；主线上的系统通知和贴回主线的后台线结果
   * （《优化清单》第 12 条）。mainLineId 是主线的 id（还没读到是 null）。
   */
  onEvent(event: LiveEvent, mainLineId: string | null = null): void {
    if (event.type === 'line') {
      this.onLineEvent(event.event, mainLineId);
      return;
    }
    if (!inDesktopApp() || event.type !== 'ask.created' || event.ask.channel !== 'interrupt'
      || event.ask.status !== 'open' || isDeferredStandaloneAsk(event.ask)
      || this.notified.has(event.ask.id)) { return; }
    try {
      hostNotify(event.ask.kindLabel, PUSH_BODY, '#/plasticine');
      this.notified.add(event.ask.id);
    } catch {
      this.store.set({ status: 'native', message: 'Mac 通知没能发出，请在对话里查看待处理的卡。' });
    }
  }

  private onLineEvent(event: Extract<LiveEvent, { type: 'line' }>['event'], mainLineId: string | null): void {
    if (!inDesktopApp() || event.type !== 'line_message' || mainLineId === null
      || event.message.lineId !== mainLineId) { return; }
    const message = event.message;
    const key = `line:${message.lineId}:${message.seq}`;
    const brief = mainLineBrief(message);
    // 同一条（部件作答后重推、断线补发）只弹一次；补发的是断线时漏掉的，照样弹。
    if (brief === null || this.notified.has(key)) {
      return;
    }
    try {
      hostNotify(NOTICE_TITLE, brief, MAIN_THREAD_PATH.slice(1));
      this.notified.add(key);
    } catch {
      this.store.set({ status: 'native', message: 'Mac 通知没能发出，请在和 Plasticine 的对话里查看。' });
    }
  }

  /** 这个操作已经被更新的操作或 dispose 顶掉了。 */
  private stale(generation: number): boolean {
    return generation !== this.generation;
  }

  private next(status: 'checking' | 'working'): number {
    this.generation += 1;
    this.store.set({ status, message: null });
    return this.generation;
  }

  /** 只有还是这个代次的操作才写状态。 */
  private settle(generation: number, status: PushSwitchStatus, message: string | null): void {
    if (generation === this.generation) {
      this.store.set({ status, message });
    }
  }

  /**
   * 回执不确定过的登记，只有订阅内容（endpoint 和两把钥匙）没变时才沿用它的 requestId；订阅换了就是另一个操作，
   * 换新标识（审查 3fe8226 P2：不然服务端回第一次的结果，新的 endpoint 根本没登记上）。
   */
  private requestIdFor(subscription: DeviceSubscription): string {
    const pending = this.pendingRequest;
    const same =
      pending !== null &&
      pending.endpoint === subscription.endpoint &&
      pending.p256dh === subscription.keys.p256dh &&
      pending.auth === subscription.keys.auth;
    if (same) {
      return pending.requestId;
    }
    const requestId = createRequestId();
    this.pendingRequest = { requestId, endpoint: subscription.endpoint, ...subscription.keys };
    return requestId;
  }

  private async register(generation: number, subscription: DeviceSubscription): Promise<void> {
    const requestId = this.requestIdFor(subscription);
    try {
      await this.api.push.subscribe({ requestId, endpoint: subscription.endpoint, keys: subscription.keys });
      if (generation === this.generation) {
        this.pendingRequest = null;
      }
      this.settle(generation, 'on', null);
    } catch (cause) {
      if (!isUncertain(cause) && generation === this.generation) {
        this.pendingRequest = null;
      }
      this.settle(generation, 'unregistered', `这台设备订阅了，但服务端还没收下：${errorText(cause)}`);
    }
  }
}
