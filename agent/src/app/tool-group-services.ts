// M5 乙路的服务装在一处：记账（life/）、云端工具（cloud-tools/）、文件页（artifacts/）、站内信（daily/inbox.ts）、通知信，
// 以及它们给线的工具（按工具组开关，开关在 tool_groups，用户确认字段）和外环的定时扫描（收信）。
// assemble.ts 只调这里的 createToolGroupServices，不碰各模块内部。

import {
  attachmentText, createCloudBrowserActTool, createCloudBrowserObserveTool, createCloudBrowserOpenTool,
  createCloudBrowserReadTool, createCloudBrowserTabsTools, createCloudSshRunTool, createCloudTools,
  Connections, createConnectionTools, createMailSendTool, createWebSearchTools, FaviconFetcher, LinkPreviewFetcher,
  WebSearch, MailImageFetcher, MailImageSigner, type CloudTools, type CloudTransports, type FaviconFetchOptions,
  type InternalBrowserCookie, type LinkPreviewFetchOptions, type MailImageFetchOptions,
} from '../cloud-tools/index.ts';
import type { InboxMessage } from '../../shared/state.ts';
import { createAttachmentTextTool, type Tool } from '../tools/index.ts';
import { createListInboxTool, createReadInboxTool } from '../intake/index.ts';
import { createArtifacts, type Artifacts } from '../artifacts/index.ts';
import type { Scan } from '../attention/index.ts';
import { InboxDesk, INBOX_PAGE_DEFAULT, previewOf } from '../daily/index.ts';
import { createLife, type Life } from '../life/index.ts';
import type { StateService } from '../state/index.ts';
import { groupOfTool } from '../../shared/api/index.ts';
import { FaviconCache } from './favicon-cache.ts';
import type { MailImages } from './mail-view.ts';

export interface ToolGroupServices {
  life: Life;
  cloud: CloudTools;
  artifacts: Artifacts;
  inbox: InboxDesk;
  /** 邮件按原样显示：远程图的代理地址签名和取图（2026-11-04 用户定：服务器代为加载）。 */
  mailImages: MailImages;
  linkPreviews: LinkPreviewFetcher;
  /** 网站图标（11-08）：本体代取、存进库里。 */
  favicons: FaviconCache;
  /** 网络搜索和抓正文（11-16，Tavily）：密钥在设置里填。 */
  webSearch: WebSearch;
  /** 通用连接（11-16）：设置里连的服务（MCP），令牌在凭据目录。 */
  connections: Connections;
  dryRun: boolean;
  stateDirectory: string;
}

export interface ToolGroupOptions {
  state: StateService;
  stateDirectory: string;
  dryRun: boolean;
  now: () => Date;
  transports?: Partial<CloudTransports>;
  checkCredentialMode?: boolean;
  /** 邮件图片代理怎么解析和核地址（测试换成固定表；默认系统 DNS + 拒绝内网）。 */
  mailImages?: MailImageFetchOptions;
  linkPreviews?: LinkPreviewFetchOptions;
  /** 网站图标代取怎么解析和核地址（测试换成固定表；默认同邮件图片）。 */
  favicons?: FaviconFetchOptions;
  internalCookies?: () => InternalBrowserCookie[];
  internalUrl?: string;
  /** 网络搜索怎么连外网（测试换成假的）。 */
  webFetch?: typeof fetch;
  /** 通用连接怎么连外网（测试换成假的，允许连本机的假服务）。 */
  connectionFetch?: { fetch: typeof fetch; allowLocal: boolean };
}

/** Whether a tool is switched on: tools in no group always are; a group without a row is on its default. */
export function toolEnabled(state: StateService, name: string): boolean {
  const group = groupOfTool(name);
  if (group === undefined) {
    return true;
  }
  return state.toolGroups.get(group.id)?.enabled ?? group.defaultEnabled;
}

export function createToolGroupServices(options: ToolGroupOptions): ToolGroupServices {
  const { state, now, dryRun, stateDirectory } = options;
  let inbox: InboxDesk | undefined;
  const cloud = createCloudTools({
    state,
    stateDirectory,
    now,
    ...(options.internalCookies === undefined ? {} : { internalCookies: options.internalCookies }),
    ...(options.internalUrl === undefined ? {} : { internalUrl: options.internalUrl }),
    ...(options.transports === undefined ? {} : { transports: options.transports }),
    ...(options.checkCredentialMode === undefined ? {} : { checkCredentialMode: options.checkCredentialMode }),
    onMail: (message) => {
      inbox?.announce(message);
    },
  });
  inbox = new InboxDesk({ state, mail: cloud.mail, dryRun, now });
  // 11-16：空转的云端浏览器网页自动结束（开发干跑时不看）。
  if (!dryRun) {
    cloud.watchdog.start();
  }
  return {
    life: createLife({ state, now }),
    cloud,
    artifacts: createArtifacts({ stateDirectory, now }),
    inbox,
    mailImages: { signer: new MailImageSigner(stateDirectory, now),
      fetcher: new MailImageFetcher(options.mailImages ?? {}) },
    linkPreviews: new LinkPreviewFetcher(options.linkPreviews),
    favicons: new FaviconCache({ store: state.favicons, fetcher: new FaviconFetcher(options.favicons ?? {}), now }),
    webSearch: new WebSearch({ settings: state.kernelSettings, fetch: options.webFetch ?? globalThis.fetch, now }),
    connections: new Connections({ state, credentials: cloud.credentials,
      ...(options.connectionFetch === undefined ? {} : { fetch: options.connectionFetch.fetch,
        allowLocal: options.connectionFetch.allowLocal }) }),
    dryRun,
    stateDirectory,
  };
}

/**
 * 一封信给脑看的样子：迁移来的原始行、清洗后的 HTML（迁移 0052，可能几百 KB）和原信、IMAP 位置这些存档字段不给，
 * 正文用纯文字的 body。
 */
function forBrain(message: InboxMessage) {
  const { legacyPayload: _legacy, bodyHtml: _html, rawPath: _raw, rawSha256: _sha, imapUid: _uid,
    uidValidity: _validity, mailbox: _mailbox, mimeAt: _mime, duplicateOf: _duplicate, ...rest } = message;
  return rest;
}

/** The brain's tools of this half of M5, each behind its group's switch. */
export function toolGroupTools(services: ToolGroupServices): Tool[] {
  const { cloud, inbox, artifacts } = services;
  return [
    createCloudSshRunTool({ run: (host, command, signal) => cloud.ssh.run(host, command, signal) }),
    createCloudBrowserOpenTool(cloud.browser),
    createCloudBrowserReadTool(cloud.browser),
    createCloudBrowserObserveTool(cloud.browser),
    createCloudBrowserActTool(cloud.browser),
    ...createCloudBrowserTabsTools(cloud.browser),
    ...createWebSearchTools(services.webSearch),
    ...createConnectionTools(services.connections),
    createMailSendTool({ sender: cloud.mail, readFile: (path) => {
      const { data, entry } = artifacts.workspace.read(path);
      return { name: entry.name, type: (entry.type ?? 'application/octet-stream').split(';')[0] ?? '', data };
    } }),
    createAttachmentTextTool({
      read: (path, signal) => {
        const { data, entry } = artifacts.workspace.read(path);
        return attachmentText(cloud.attachments, { name: entry.name, data }, signal);
      },
    }),
    createListInboxTool({
      list: (box, query) => {
        const { messages, total } = inbox.page(box, query, 0, INBOX_PAGE_DEFAULT);
        const rows = messages.map((message) => {
          const { body, ...rest } = forBrain(message);
          return { ...rest, preview: previewOf(body) };
        });
        return { messages: rows, total };
      },
    }),
    createReadInboxTool({
      read: (id) => {
        const { message } = inbox.open(id);
        return { ...forBrain(message), body: Array.from(message.body).slice(0, 12_000).join('') };
      },
    }),
  ];
}

export function toolGroupScans(services: ToolGroupServices): Scan[] {
  return [...services.cloud.scans];
}

