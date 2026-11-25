import type { NotifyEvent, NotifyKind, PushPayload } from '../../shared/api/push.ts';
import { errorCategory, safeLog } from '../util/index.ts';
import type { Presence } from './presence.ts';

export const GROUP_MERGE_MS = 2 * 60 * 1000;
export const ALERT_TEXT_MAX = 60;

export interface ContactAlert {
  contactId: string;
  name: string;
  messageId: string;
  text: string;
  sender: string | null;
  group: boolean;
}

export interface LineAlert {
  lineId: string;
  kind: Extract<NotifyKind, 'main' | 'mate'>;
  seq: number;
  name: string;
  text: string;
}

export interface MessageAlertsOptions {
  presence: Presence;
  push: { announce(payload: PushPayload): Promise<unknown> };
  publish: (event: NotifyEvent) => void;
  now: () => Date;
  allowed?: (kind: NotifyKind) => boolean;
}

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
  readonly #bursts = new Map<string, { count: number; at: number }>();

  constructor(options: MessageAlertsOptions) {
    this.#options = options;
  }

  contact(alert: ContactAlert): boolean {
    const brief = alertBrief(alert.text);
    const conversation = `contact:${alert.contactId}`;
    if (this.#options.allowed?.(alert.group ? 'group' : 'contact') === false) return false;
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

  line(alert: LineAlert): boolean {
    const brief = alertBrief(alert.text);
    const conversation = `line:${alert.lineId}`;
    if (this.#options.allowed?.(alert.kind) === false) return false;
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
