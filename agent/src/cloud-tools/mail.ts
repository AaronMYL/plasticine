// 邮件（《实施方案》第 2 节：Gmail IMAP 只读收信、邮件通知）：收信把新邮件放进站内信（同一个 Message-ID 只一封），发信给
// 提醒、启用成功和回复用；Gmail 固定寄给自己。凭据只引用 credentials/gmail，这里不读，传输连接时才读。收信出错
// 只记一句话和类别，不记服务器回的原文（可能带账号）。地址和标题不许带换行（邮件头注入）。

import { randomUUID } from 'node:crypto';
import type { InboxMessage } from '../../shared/state.ts';
import type { StateService } from '../state/index.ts';
import { errorCategory, failureText, safeLog } from '../shared-log.ts';
import type { CredentialFiles } from './credentials.ts';
import { GMAIL_CREDENTIAL } from './gmail.ts';
import { CloudToolError } from './errors.ts';
import type { MailFiles } from './mail-files.ts';
import { clip, mailInput, storeMailFiles } from './mail-input.ts';
import type { FetchedMail, ImapTransport, MailTransport } from './transports.ts';
export { SELF_MAIL_ADDRESS } from './transports.ts';

export const IMAP_CREDENTIAL = GMAIL_CREDENTIAL;
export const SMTP_CREDENTIAL = GMAIL_CREDENTIAL;
// M6：收信每十分钟，服务重启后也参考已落盘的上次尝试时间。
const SYNC_INTERVAL_MS = 10 * 60 * 1000;
// 一次收信最多等 90 秒（1ca0391 inbox.ts）。
export const SYNC_TIMEOUT_MS = 90_000;
// 一封信最多发 30 秒。
export const SEND_TIMEOUT_MS = 30_000;
const EMAIL_PATTERN = /^[^\s@<>"]{1,64}@[^\s@<>"]{1,190}\.[A-Za-z]{2,}$/;
// 收信只看收件箱。
const INBOX_MAILBOX = 'INBOX';

/** A short, credential-free sentence for the sync record. */
function syncError(error: unknown): string {
  return `收信失败：${failureText(error)}下一轮再试。`;
}

export interface MailSyncDeps {
  state: StateService;
  transport: ImapTransport;
  credentials: CredentialFiles;
  now: () => Date;
  onAdded?: (message: InboxMessage) => void;
  /** 原信和内嵌图落盘的地方（迁移 0052）；没给就只存库里的列（旧的测试装配）。 */
  files?: MailFiles;
}

export class MailSync {
  readonly #deps: MailSyncDeps;
  #running: Promise<number> | null = null;
  readonly #controller = new AbortController();

  constructor(deps: MailSyncDeps) {
    this.#deps = deps;
  }

  configured(): boolean {
    return this.#deps.credentials.status(IMAP_CREDENTIAL) === 'ready';
  }

  /** Fetches what is new since the last sync; returns how many messages were added. One at a time. */
  sync(signal: AbortSignal = AbortSignal.timeout(SYNC_TIMEOUT_MS)): Promise<number> {
    const combined = AbortSignal.any([signal, this.#controller.signal]);
    this.#running ??= this.#sync(combined).finally(() => {
      this.#running = null;
    });
    return this.#running;
  }

  /** The outer loop's scan: only when the account is set up, never two at once, errors only recorded. */
  scan(): 'skipped' | 'started' {
    const last = this.#deps.state.inboxSync.get()?.lastSyncAt;
    const tooSoon = last != null && this.#deps.now().getTime() - Date.parse(last) < SYNC_INTERVAL_MS;
    if (!this.configured() || this.#running !== null || tooSoon || this.#controller.signal.aborted) {
      return 'skipped';
    }
    this.sync().catch((error: unknown) => {
      safeLog('error', 'mail_sync_failed', { category: errorCategory(error) });
    });
    return 'started';
  }

  async stop(): Promise<void> {
    this.#controller.abort();
    await this.#running?.catch((error: unknown) => {
      safeLog('error', 'mail_sync_stopped', { category: errorCategory(error) });
    });
  }

  async #sync(signal: AbortSignal): Promise<number> {
    const { state, transport, now } = this.#deps;
    const cursor = state.inboxSync.get();
    try {
      const result = await transport.fetch(
        { credential: IMAP_CREDENTIAL },
        { uidValidity: cursor?.uidValidity ?? null, lastUid: cursor?.lastUid ?? null },
        signal,
      );
      // A new UIDVALIDITY means the mailbox was rebuilt: the old position means nothing, the Message-ID still dedupes.
      const sameBox = cursor?.uidValidity === result.uidValidity;
      let lastUid = sameBox ? (cursor?.lastUid ?? 0) : 0;
      const added: InboxMessage[] = [];
      state.transaction(() => {
        for (const mail of result.messages) {
          lastUid = Math.max(lastUid, mail.uid);
          const outcome = this.#save(mail, result.uidValidity, now().toISOString());
          if (outcome.created) {
            added.push(outcome.message);
          }
        }
        state.inboxSync.record({
          uidValidity: result.uidValidity,
          lastUid,
          lastSyncAt: now().toISOString(),
          lastCount: added.length,
          lastError: null,
        });
      });
      for (const message of added) {
        this.#deps.onAdded?.(message);
      }
      return added.length;
    } catch (error) {
      state.inboxSync.record({ lastSyncAt: now().toISOString(), lastError: syncError(error) });
      throw error;
    }
  }

  /** 存一封：同一个 Message-ID 已经有了就拿回原来那一条，不落盘；新的先定 id，原信和内嵌图按 id 落盘再建行。 */
  #save(mail: FetchedMail, uidValidity: number, at: string): { message: InboxMessage; created: boolean } {
    const { state, files } = this.#deps;
    const input = mailInput(mail, { uidValidity, mailbox: INBOX_MAILBOX }, at);
    const existing = input.messageId === undefined || input.messageId === null ? undefined
      : state.inboxMessages.byMessageId(input.messageId);
    if (existing !== undefined) {
      return { message: existing, created: false };
    }
    const id = randomUUID();
    const stored = storeMailFiles(files, id, mail);
    const outcome = state.inboxMessages.add({ ...input, rawPath: stored.rawPath, rawSha256: stored.rawSha256 },
      { id });
    for (const part of stored.parts) {
      state.inboxMailParts.add(part);
    }
    return outcome;
  }
}

export interface MailToSend {
  to: string;
  subject: string;
  text: string;
  inReplyTo: string | null;
}

export interface MailSender {
  configured(): boolean;
  send(input: MailToSend, signal: AbortSignal): Promise<void>;
}

/** Sends one mail through the transport after checking the address and headers. */
export function createMailSender(transport: MailTransport, credentials: CredentialFiles): MailSender {
  return {
    configured: () => credentials.status(SMTP_CREDENTIAL) === 'ready',
    async send(input, signal) {
      if (!EMAIL_PATTERN.test(input.to)) {
        throw new CloudToolError('invalid_input', '收件地址不是有效的邮箱，没有发。', 'to');
      }
      if (/[\r\n]/.test(input.subject) || /[\r\n]/.test(input.inReplyTo ?? '')) {
        throw new CloudToolError('invalid_input', '邮件标题里不能有换行，没有发。', 'subject');
      }
      await transport.send({ credential: SMTP_CREDENTIAL }, { ...input, subject: clip(input.subject, 200) }, signal);
    },
  };
}
