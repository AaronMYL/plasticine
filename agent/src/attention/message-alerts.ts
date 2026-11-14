// 新消息通知（第13批，11-14 Aaron 定）：联系人的新消息、群组的新消息、主线回复、队友回复——主线和队友只通知他自己发起
// 的那一轮的回复（调用方 app/reply-alerts.ts 判断），主线和队友之间、队友之间互相发的不通知。通知写谁发的 + 消息开头
// （弹框选，取代第 91 条「只写一句固定的话」）；点开进那段对话、定位到那一句；正在看的那段不通知（presence.ts）；同一个
// 群 2 分钟内连着来的合成一条「n 条新消息」，同一个 tag，新的换掉旧的。
// 网页推送（iPhone 主屏幕网页、浏览器）走 PushService；桌面客户端收不到网页推送，发一个 notify 事件让界面自己弹。

import type { NotifyEvent, PushPayload } from '../../shared/api/push.ts';
import { errorCategory, safeLog } from '../shared-log.ts';
import type { Presence } from './presence.ts';

/** 同一个群连着来的，间隔在这之内就合成一条。 */
export const GROUP_MERGE_MS = 2 * 60 * 1000;
/** 消息开头最多这么多字。 */
export const ALERT_TEXT_MAX = 60;

export interface ContactAlert {
  /** 联系人或群的 id。 */
  contactId: string;
  /** 一对一是对方的名字，群是群名。 */
  name: string;
  messageId: string;
  text: string;
  /** 群里是谁说的。 */
  sender: string | null;
  group: boolean;
}

export interface LineAlert {
  lineId: string;
  seq: number;
  /** 主线的名字、队友的名字或群组名。 */
  name: string;
  text: string;
}

export interface MessageAlertsOptions {
  presence: Presence;
  push: { announce(payload: PushPayload): Promise<unknown> };
  publish: (event: NotifyEvent) => void;
  now: () => Date;
}

/** 消息开头：去掉 Markdown 记号（标题、加粗、链接、代码），并成一行，太长截断加「…」。 */
export function alertBrief(text: string): string {
  const plain = text
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^\s{0,3}(#{1,6}|>|[-*+]|\d+\.)\s+/gm, '')
    .replace(/(\*\*|__|\*|_|~~|`)/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  const chars = Array.from(plain);
  return chars.length <= ALERT_TEXT_MAX ? plain : `${chars.slice(0, ALERT_TEXT_MAX - 1).join('')}…`;
}

export class MessageAlerts {
  readonly #options: MessageAlertsOptions;
  /** 群里连着来的：tag → 这一串有几条、最后一条什么时候。 */
  readonly #bursts = new Map<string, { count: number; at: number }>();

  constructor(options: MessageAlertsOptions) {
    this.#options = options;
  }

  /** 联系人或群的一句新消息；返回发没发（正在看、没有字就不发）。 */
  contact(alert: ContactAlert): boolean {
    const brief = alertBrief(alert.text);
    const conversation = `contact:${alert.contactId}`;
    if (brief === '' || this.#options.presence.viewing(conversation, this.#options.now())) {
      this.#bursts.delete(alert.contactId);
      return false;
    }
    let body = brief;
    if (alert.group) {
      const now = this.#options.now().getTime();
      const last = this.#bursts.get(alert.contactId);
      const count = last !== undefined && now - last.at <= GROUP_MERGE_MS ? last.count + 1 : 1;
      this.#bursts.set(alert.contactId, { count, at: now });
      body = count > 1 ? `${count} 条新消息` : `${alert.sender ?? '有人'}：${brief}`;
    }
    const url = `/#/messages/${encodeURIComponent(alert.contactId)}/at/${encodeURIComponent(alert.messageId)}`;
    this.#send({ title: alert.name, body, url, tag: `contact-${alert.contactId}` }, conversation);
    return true;
  }

  /** 主线或队友这一轮的回复；返回发没发。 */
  line(alert: LineAlert): boolean {
    const brief = alertBrief(alert.text);
    const conversation = `line:${alert.lineId}`;
    if (brief === '' || this.#options.presence.viewing(conversation, this.#options.now())) return false;
    const url = `/#/plasticine/${encodeURIComponent(`line:${alert.lineId}:${alert.seq}`)}`;
    this.#send({ title: alert.name, body: brief, url, tag: `line-${alert.lineId}` }, conversation);
    return true;
  }

  #send(payload: PushPayload, conversation: string): void {
    this.#options.publish({ type: 'notify', ...payload, conversation });
    this.#options.push.announce(payload).catch((error: unknown) => {
      safeLog('error', 'message_alert_push_failed', { category: errorCategory(error) });
    });
  }
}
