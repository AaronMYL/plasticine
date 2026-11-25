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

export interface BrowserProcess {
  pid: number;
  type: string;
  cpuSeconds: number;
}

export interface BrowserTransport {
  processes?(signal: AbortSignal): Promise<BrowserProcess[] | null>;
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
  html?: string | null;
  raw?: Buffer | null;
  inline?: MailInlinePart[];
  mime?: boolean;
}

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
  moreTo?: readonly string[];
  cc?: readonly string[];
  bcc?: readonly string[];
  attachments?: readonly { name: string; type: string; data: Buffer }[];
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

export const SELF_MAIL_ADDRESS = 'self@plasticine.invalid';
