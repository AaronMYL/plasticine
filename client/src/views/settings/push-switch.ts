import type { PlasticineApi } from '../../api/client.ts';
import { errorText, isUncertain } from '../../api/errors.ts';
import type { DeviceSubscription, PushDevice, PushPermission } from '../../api/push-device.ts';
import { createRequestId } from '../../api/request-id.ts';
import { Store } from '../../state/store.ts';
import { hostNotify, inDesktopApp } from '../../shell/host.ts';
import { isDeferredStandaloneAsk, LETTER_BRIEF, MAIN_THREAD_PATH, NOTICE_TITLE, NOTIFY_KINDS_DEFAULT, PUSH_BODY,
  pushTag, reportBrief, type LineMessageView, type NotifyKind, type NotifyKinds } from '../../api/shared.ts';
import type { LiveEvent } from '../../api/types.ts';
import { lookingAt } from '../../state/viewing.ts';

export type PushSwitchStatus =
  'checking' | 'unsupported' | 'denied' | 'off' | 'on' | 'unregistered' | 'working' | 'native';

export interface PushSwitchState {
  status: PushSwitchStatus;
  message: string | null;
}

export function mainLineBrief(message: LineMessageView): string | null {
  if (message.role === 'notice') return message.summary ?? null;
  if (message.role === 'lineReport') return reportBrief(message.stopReason);
  if (message.role === 'letter') return LETTER_BRIEF;
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

export function isBusy(status: PushSwitchStatus): boolean {
  return status === 'checking' || status === 'working';
}

export class PushSwitch {
  readonly store = new Store<PushSwitchState>({ status: 'checking', message: null });
  private readonly api: PlasticineApi;
  private readonly device: PushDevice;
  private pendingRequest: PendingRegistration | null = null;
  private generation = 0;
  private readonly notified = new Set<string>();
  readonly kinds = new Store<NotifyKinds>({ ...NOTIFY_KINDS_DEFAULT });
  readonly kindsError = new Store<string | null>(null);
  private kindsSaving: Promise<unknown> = Promise.resolve();

  constructor(api: PlasticineApi, device: PushDevice) {
    this.api = api;
    this.device = device;
  }

  async loadKinds(): Promise<void> {
    try {
      this.kinds.set(await this.api.push.kinds());
      this.kindsError.set(null);
    } catch (cause) {
      this.kindsError.set(`读不到通知开关：${errorText(cause)}`);
    }
  }

  setKind(kind: NotifyKind, on: boolean): Promise<void> {
    const before = this.kinds.get();
    const next = { ...before, [kind]: on };
    this.kinds.set(next);
    const work = this.kindsSaving.then(async () => {
      try {
        this.kinds.set(await this.api.push.saveKinds(this.kinds.get()));
        this.kindsError.set(null);
      } catch (cause) {
        this.kinds.set({ ...this.kinds.get(), [kind]: before[kind] });
        this.kindsError.set(`没存上：${errorText(cause)}`);
      }
    });
    this.kindsSaving = work;
    return work;
  }

  async start(): Promise<void> {
    void this.loadKinds();
    void this.closeWithdrawn();
    const generation = this.next('checking');
    if (inDesktopApp()) {
      this.settle(generation, 'native', null);
      return;
    }
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

  async enable(): Promise<void> {
    if (inDesktopApp()) {
      this.store.set({ status: 'native', message: null });
      return;
    }
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
      const message = `这台设备已经不再接收；服务端那条登记没删除（${reason}）它下次推送失败时会自己停用。`;
      this.settle(generation, 'off', message);
    }
  }

  dispose(): void {
    this.generation += 1;
  }

  onEvent(event: LiveEvent, mainLineId: string | null = null): void {
    if (event.type === 'line') {
      this.onLineEvent(event.event, mainLineId);
      return;
    }
    if (event.type === 'notify') {
      this.onNotify(event);
      return;
    }
    if (event.type === 'notify.kinds') {
      this.kinds.set(event.kinds);
      return;
    }
    if (event.type === 'pushes.changed') {
      void this.closeWithdrawn();
      return;
    }
    if (!inDesktopApp() || event.type !== 'ask.created' || !this.kinds.get().ask || event.ask.channel !== 'interrupt'
      || event.ask.status !== 'open' || isDeferredStandaloneAsk(event.ask)
      || this.notified.has(event.ask.id)) { return; }
    try {
      hostNotify(event.ask.kindLabel, PUSH_BODY, '#/plasticine');
      this.notified.add(event.ask.id);
    } catch {
      this.store.set({ status: 'native', message: '系统通知没能发出，请在对话里查看待处理的卡。' });
    }
  }

  private onLineEvent(event: Extract<LiveEvent, { type: 'line' }>['event'], mainLineId: string | null): void {
    if (!inDesktopApp() || event.type !== 'line_message' || mainLineId === null
      || event.message.lineId !== mainLineId) { return; }
    const message = event.message;
    const key = `line:${message.lineId}:${message.seq}`;
    const brief = mainLineBrief(message);
    if (!this.kinds.get()[message.role === 'letter' ? 'letter' : 'notice']) return;
    if (brief === null || this.notified.has(key)) {
      return;
    }
    try {
      hostNotify(NOTICE_TITLE, brief, MAIN_THREAD_PATH.slice(1));
      this.notified.add(key);
    } catch {
      this.store.set({ status: 'native', message: '系统通知没能发出，请在和 Plasticine 的对话里查看。' });
    }
  }

  private async closeWithdrawn(): Promise<void> {
    if (inDesktopApp() || this.device.close === undefined || this.device.unsupportedReason() !== null) return;
    try {
      const withdrawn = (await this.api.pushes.list()).filter((push) => push.withdrawnAt !== null);
      if (withdrawn.length > 0) await this.device.close(withdrawn.map((push) => pushTag(push.id)));
    } catch (cause) {
      console.warn('撤回的推送这次没收掉，下次打开再收', cause);
    }
  }

  private onNotify(event: Extract<LiveEvent, { type: 'notify' }>): void {
    const key = `${event.tag}|${event.url}`;
    if (!inDesktopApp() || this.notified.has(key) || lookingAt(event.conversation)) {
      return;
    }
    try {
      hostNotify(event.title, event.body, event.url.replace(/^\//, ''));
      this.notified.add(key);
    } catch {
      this.store.set({ status: 'native', message: '系统通知没能发出，请在对话里查看新消息。' });
    }
  }

  private stale(generation: number): boolean {
    return generation !== this.generation;
  }

  private next(status: 'checking' | 'working'): number {
    this.generation += 1;
    this.store.set({ status, message: null });
    return this.generation;
  }

  private settle(generation: number, status: PushSwitchStatus, message: string | null): void {
    if (generation === this.generation) {
      this.store.set({ status, message });
    }
  }

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
