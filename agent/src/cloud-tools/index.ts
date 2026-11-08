// cloud-tools/: 云端执行器（《应用架构方案》第 3 节、structure.md）——云端命令（SSH，名单上的主机）、云端浏览器、邮件
// （IMAP 只读收信、发信）、附件转文字。M6 浏览器默认连回环 CDP，其余默认仍不连。凭据只按
// 名字引用（credentials/，0600），不进日志、不进库、不回给客户端。有副作用的动作在调用方走回执（execution/receipts.ts 的
// 规则：脑的工具经 brain/tools/dispatch.ts，界面上的操作经 app/external-actions.ts）。

import { join } from 'node:path';
import type { InboxMessage } from '../../shared/state.ts';
import type { StateService } from '../state/index.ts';
import { CloudBrowser } from './browser.ts';
import { CdpBrowser, type InternalBrowserCookie } from './cdp-browser.ts';
import { CREDENTIALS_DIRECTORY, CredentialFiles } from './credentials.ts';
import { MailFiles } from './mail-files.ts';
import { MailRefetch } from './mail-refetch.ts';
import { createMailSender, MailSync } from './mail.ts';
import { CloudSsh } from './ssh.ts';
import { unconnectedTransports, type CloudTransports } from './transports.ts';

export { ownNoticeTitle } from './own-notice.ts';
export { ATTACHMENT_MAX_BYTES, attachmentText, CONVERTED_TYPES, extensionOf, TEXT_TYPES } from './attachments.ts';
export { extractConversationAttachment } from './conversation-attachments.ts';
export { checkAction, CloudBrowser, FRAME_MAX_PX, KEY_PATTERN, SCROLL_MAX_PX, TYPE_MAX_CHARS } from './browser.ts';
export type { BrowserObservation, BrowserSink, BrowserView } from './browser.ts';
export { CdpBrowser } from './cdp-browser.ts';
export type { InternalBrowserCookie } from './cdp-browser.ts';
export { encodedSize } from './cdp-viewport.ts';
export type { BrowserWatch } from './transports.ts';
export { CREDENTIAL_NAME_PATTERN, CREDENTIALS_DIRECTORY, CredentialFiles } from './credentials.ts';
export type { CredentialStatus } from './credentials.ts';
export { CLOUD_TOOL_ERROR_CODES, CloudToolError } from './errors.ts';
export type { CloudToolErrorCode } from './errors.ts';
export { createMailSender, IMAP_CREDENTIAL, MailSync, SELF_MAIL_ADDRESS, SEND_TIMEOUT_MS, SMTP_CREDENTIAL }
  from './mail.ts';
export type { MailSender } from './mail.ts';
export { createGmailTransports, GMAIL_CREDENTIAL } from './gmail.ts';
export { MailFiles } from './mail-files.ts';
export { MailRefetch } from './mail-refetch.ts';
export type { RefetchItem, RefetchOutcome, RefetchReport } from './mail-refetch.ts';
export { keepImageUrl, sanitizeMailHtml } from './mail-sanitize.ts';
export type { ImageResolver } from './mail-sanitize.ts';
export { CloudSsh, COMMAND_MAX_CHARS, readSshHosts, SSH_HOSTS_FILE } from './ssh.ts';
export { BROWSER_ACTION_KINDS, unconnectedTransports } from './transports.ts';
export type {
  AttachmentTransport,
  BrowserAction,
  BrowserPage,
  BrowserTransport,
  CloudTransports,
  FetchedMail,
  ImapCursor,
  ImapTransport,
  MailTransport,
  OutgoingMail,
  RefetchResult,
  RefetchTarget,
  SshResult,
  SshTarget,
  SshTransport,
} from './transports.ts';
export { checkPublicHttpsUrl, displayUrl, isPrivateHost } from './urls.ts';

export interface CloudToolsOptions {
  state: StateService;
  /** The state directory: credentials/ and cloud-tools/ssh-hosts.json live in it. */
  stateDirectory: string;
  transports?: Partial<CloudTransports>;
  now: () => Date;
  onMail?: (message: InboxMessage) => void;
  /** Tests on Windows set this to check 0600 the way a Linux host does. */
  checkCredentialMode?: boolean;
  internalCookies?: () => InternalBrowserCookie[];
  internalUrl?: string;
}

export function createCloudTools(options: CloudToolsOptions) {
  const browserOptions = {
    ...(options.internalCookies === undefined ? {} : { internalCookies: options.internalCookies }),
    ...(options.internalUrl === undefined ? {} : { internalUrl: options.internalUrl }) };
  const transports: CloudTransports = { ...unconnectedTransports(), browser: new CdpBrowser(browserOptions),
    ...options.transports };
  const credentials = new CredentialFiles(
    join(options.stateDirectory, CREDENTIALS_DIRECTORY),
    options.checkCredentialMode ?? process.platform !== 'win32',
  );
  const transportAvailable = { ssh: options.transports?.ssh !== undefined,
    imap: options.transports?.imap !== undefined, mail: options.transports?.mail !== undefined,
    attachments: options.transports?.attachments !== undefined };
  const ssh = new CloudSsh({ stateDirectory: options.stateDirectory, transport: transports.ssh, credentials,
    connected: transportAvailable.ssh });
  const browser = new CloudBrowser({ transport: transports.browser, now: options.now,
    stateDirectory: options.stateDirectory,
    ...(options.internalUrl === undefined ? {} : { internalUrl: options.internalUrl }) });
  const mailFiles = new MailFiles(options.stateDirectory);
  const mailSync = new MailSync({
    state: options.state,
    transport: transports.imap,
    credentials,
    now: options.now,
    files: mailFiles,
    ...(options.onMail === undefined ? {} : { onAdded: options.onMail }),
  });
  const mailRefetch = new MailRefetch({ state: options.state, transport: transports.imap, credentials,
    files: mailFiles, now: options.now });
  const mail = createMailSender(transports.mail, credentials);
  return {
    ssh,
    browser,
    mailSync,
    mailRefetch,
    mailFiles,
    mail,
    credentials,
    attachments: transports.attachments,
    transportAvailable,
    scans: [{ name: '站内信收信', run: () => mailSync.scan() }],
  };
}

export type CloudTools = ReturnType<typeof createCloudTools>;
export { SYNC_TIMEOUT_MS } from './mail.ts';
export { ServerCommands } from './server-command.ts';
export type { ServerCommandPage, ServerCommandResult } from './server-command.ts';
