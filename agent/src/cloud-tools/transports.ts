// 云端工具怎么真的连出去：每样一个注入的传输（《实施方案》测试规矩：外部服务都有假实现）。M5 不连任何真实服务，默认的
// 传输一律回「还没接上」，不碰网络、不读凭据；M6 由 index.ts 覆盖浏览器为真实回环 CDP。
// 传输拿到的凭据只是名字（credential），要用时自己经 CredentialFiles 读。

import { CloudToolError } from './errors.ts';
import type { MailInlinePart } from './mail-parse.ts';
import type { BrowserInspection } from '../../shared/browser-observation.ts';
import type {
  BrowserActionInput, BrowserFrame, BrowserTab, BrowserTabAction, BrowserViewport,
} from '../../shared/api/browser.ts';

export interface SshTarget {
  name: string;
  host: string;
  port: number;
  user: string;
  credential: string;
}

export interface SshResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export interface SshTransport {
  run(target: SshTarget, command: string, options: { signal: AbortSignal; timeoutMs: number }): Promise<SshResult>;
}

/** One page in the cloud browser as the transport sees it. */
export interface BrowserPage {
  sessionId: string;
  url: string;
  title: string;
  editableFocused?: boolean;
}

export const BROWSER_ACTION_KINDS = [
  'click', 'move', 'type', 'key', 'scroll', 'back', 'forward', 'reload', 'stop',
] as const;
export type BrowserAction = BrowserActionInput;

export interface BrowserSnapshot { tabs: BrowserTab[]; activeTabId: string | null; loading?: boolean }
export interface BrowserWatch { ack(sequence: number): Promise<void>; close(targetGone?: boolean): Promise<void> }

export interface BrowserTransport {
  publishX?(text: string, signal: AbortSignal): Promise<{ url: string }>;
  open(url: string, signal: AbortSignal): Promise<BrowserPage>;
  act(sessionId: string, action: BrowserAction, signal: AbortSignal): Promise<BrowserPage>;
  /** A PNG of what the page shows now. */
  frame(sessionId: string, signal: AbortSignal): Promise<Buffer>;
  /** The page's visible text, for the brain to read. */
  text(sessionId: string, signal: AbortSignal): Promise<string>;
  observe?(sessionId: string, signal: AbortSignal): Promise<BrowserInspection>;
  snapshot?(signal: AbortSignal): Promise<BrowserSnapshot>;
  tab?(action: BrowserTabAction, signal: AbortSignal): Promise<BrowserSnapshot>;
  watch?(
    viewport: BrowserViewport, frame: (frame: BrowserFrame) => void,
    disconnected: () => void, signal: AbortSignal, changed?: (snapshot: BrowserSnapshot) => void,
  ): Promise<BrowserWatch>;
  close?(): void;
  disconnect?(): void;
}

/** One message as the IMAP transport hands it over, already decoded. */
export interface FetchedMail {
  uid: number;
  messageId: string | null;
  fromAddress: string;
  fromName: string | null;
  toAddress: string | null;
  subject: string;
  text: string;
  date: string | null;
  attachments: string[];
  /** 信里原样的 HTML（还没清洗，mail-parse.ts）；只有纯文字的信、或旧的假传输没有。 */
  html?: string | null;
  /** 整封原信；超过整封抓取上限、只抓了正文和内嵌图分段的信没有。 */
  raw?: Buffer | null;
  /** HTML 里 cid: 引用的内嵌图。 */
  inline?: MailInlinePart[];
  /** 按整封 MIME 解析过（新版收信都是）；false / 没有 = 旧的假传输那样只有文字。 */
  mime?: boolean;
}

/** mail.refetch 要在 Gmail 里找回的一封：先按 Message-ID 找，旧版迁来的没有标准 Message-ID 时按发件人、日期和标题找。 */
export interface RefetchTarget {
  messageId: string | null;
  fromAddress: string;
  title: string;
  receivedAt: string;
}

export type RefetchResult =
  | { kind: 'found'; mail: FetchedMail; uidValidity: number; mailbox: string }
  | { kind: 'not_found' }
  | { kind: 'error'; message: string };

export interface ImapCursor {
  uidValidity: number | null;
  lastUid: number | null;
}

export interface ImapTransport {
  fetch(
    account: { credential: string },
    cursor: ImapCursor,
    signal: AbortSignal,
  ): Promise<{ uidValidity: number; messages: FetchedMail[] }>;
  /** mail.refetch：在「所有邮件」里只读地找回一批信的整封（一次连接）；结果和 targets 一一对应。 */
  refetch?(
    account: { credential: string },
    targets: readonly RefetchTarget[],
    signal: AbortSignal,
  ): Promise<RefetchResult[]>;
}

export interface OutgoingMail {
  to: string;
  subject: string;
  text: string;
  inReplyTo: string | null;
}

export interface MailTransport {
  send(account: { credential: string }, mail: OutgoingMail, signal: AbortSignal): Promise<void>;
}

export interface AttachmentTransport {
  toText(data: Buffer, type: string, signal: AbortSignal): Promise<string>;
}

export interface CloudTransports {
  ssh: SshTransport;
  browser: BrowserTransport;
  imap: ImapTransport;
  mail: MailTransport;
  attachments: AttachmentTransport;
}

function notConnected(what: string): never {
  throw new CloudToolError('not_configured', `${what}还没接上（这一版不连外部服务）。`);
}

/** M5's transports: every one refuses, so nothing leaves the machine and no credential is read. */
export function unconnectedTransports(): CloudTransports {
  return {
    ssh: { run: async () => notConnected('云端命令') },
    browser: {
      open: async () => notConnected('云端浏览器'),
      act: async () => notConnected('云端浏览器'),
      frame: async () => notConnected('云端浏览器'),
      text: async () => notConnected('云端浏览器'),
    },
    imap: { fetch: async () => notConnected('收信') },
    mail: { send: async () => notConnected('发信') },
    attachments: { toText: async () => notConnected('附件转文字') },
  };
}

/**
 * 寄给自己（Plasticine 的通知信、提醒）：Gmail 在连接那一刻换成凭据里的那个地址。别的地址只来自站内信回复——
 * 用户在联系人里对一封邮件点了发送（第 113 条），寄回原发件人。
 */
export const SELF_MAIL_ADDRESS = 'self@plasticine.invalid';
