import { MAIL_REFETCH_MAX_LIMIT } from '../../shared/api/maintenance.ts';
import type { InboxMessage } from '../../shared/state.ts';
import type { StateService } from '../state/index.ts';
import type { CredentialFiles } from './credentials.ts';
import { CloudToolError } from './errors.ts';
import { GMAIL_CREDENTIAL } from './gmail.ts';
import type { MailFiles } from './mail-files.ts';
import { mailRefill, storeMailFiles } from './mail-input.ts';
import type { ImapTransport, RefetchResult } from './transports.ts';

const REFETCH_CHUNK = 10;
const REFETCH_PAUSE_MS = 2_000;
const REFETCH_CHUNK_TIMEOUT_MS = 180_000;

export type RefetchOutcome = 'found' | 'not_found' | 'error';

export interface RefetchItem {
  id: string;
  outcome: RefetchOutcome;
  error?: string;
}

export interface RefetchReport {
  tried: number;
  found: number;
  notFound: number;
  errors: number;
  remaining: number;
  items: RefetchItem[];
}

export interface MailRefetchDeps {
  state: StateService;
  transport: ImapTransport;
  credentials: CredentialFiles;
  files: MailFiles;
  now: () => Date;
  sleep?: (ms: number) => Promise<void>;
}

const wait = (ms: number): Promise<void> => new Promise((resolve) => {
  setTimeout(resolve, ms);
});

export class MailRefetch {
  readonly #deps: MailRefetchDeps;
  #running = false;

  constructor(deps: MailRefetchDeps) {
    this.#deps = deps;
  }

  async run(limit: number, signal: AbortSignal): Promise<RefetchReport> {
    const { transport, credentials } = this.#deps;
    if (transport.refetch === undefined || credentials.status(GMAIL_CREDENTIAL) !== 'ready') {
      throw new CloudToolError('not_configured', '收信还没接上 Gmail，没法从 Gmail 重新抓。');
    }
    if (this.#running) {
      throw new CloudToolError('failed', '上一次重抓还没完，等它完了再跑。');
    }
    this.#running = true;
    try {
      return await this.#run(limit, signal);
    } finally {
      this.#running = false;
    }
  }

  async #run(limit: number, signal: AbortSignal): Promise<RefetchReport> {
    const { state } = this.#deps;
    const rows = state.inboxMessages.needingMime(Math.min(Math.max(1, limit), MAIL_REFETCH_MAX_LIMIT));
    const items: RefetchItem[] = [];
    for (let start = 0; start < rows.length; start += REFETCH_CHUNK) {
      if (start > 0) {
        await (this.#deps.sleep ?? wait)(REFETCH_PAUSE_MS);
      }
      signal.throwIfAborted();
      const chunk = rows.slice(start, start + REFETCH_CHUNK);
      items.push(...await this.#chunk(chunk, signal));
    }
    return {
      tried: items.length,
      found: items.filter((item) => item.outcome === 'found').length,
      notFound: items.filter((item) => item.outcome === 'not_found').length,
      errors: items.filter((item) => item.outcome === 'error').length,
      remaining: state.inboxMessages.untriedMime(),
      items,
    };
  }

  async #chunk(rows: readonly InboxMessage[], signal: AbortSignal): Promise<RefetchItem[]> {
    const refetch = this.#deps.transport.refetch?.bind(this.#deps.transport);
    if (refetch === undefined) {
      return rows.map((row) => ({ id: row.id, outcome: 'error', error: '收信没有重抓的能力。' }));
    }
    let results: RefetchResult[];
    try {
      results = await refetch({ credential: GMAIL_CREDENTIAL }, rows.map((row) => ({
        messageId: row.messageId, fromAddress: row.fromAddress, title: row.title, receivedAt: row.receivedAt,
      })), AbortSignal.any([signal, AbortSignal.timeout(REFETCH_CHUNK_TIMEOUT_MS)]));
    } catch (error) {
      const message = error instanceof CloudToolError ? error.message : '连 Gmail 出错，这一块没补；下次重跑再补。';
      return rows.map((row) => ({ id: row.id, outcome: 'error', error: message }));
    }
    return rows.map((row, index) => this.#apply(row, results[index]));
  }

  #apply(row: InboxMessage, result: RefetchResult | undefined): RefetchItem {
    const { state, files, now } = this.#deps;
    if (result === undefined || result.kind === 'error') {
      return { id: row.id, outcome: 'error', error: result?.message ?? '这一封没有回结果，下次重跑再补。' };
    }
    const at = now().toISOString();
    const current = state.inboxMessages.require(row.id);
    if (result.kind === 'not_found') {
      state.inboxMessages.update(current.id, current.version, { mimeTriedAt: at });
      return { id: row.id, outcome: 'not_found' };
    }
    const stored = storeMailFiles(files, current.id, result.mail);
    state.transaction(() => {
      state.inboxMessages.refill(current.id, current.version, mailRefill(result.mail, current,
        { uidValidity: result.uidValidity, mailbox: result.mailbox }, at, stored));
      for (const part of stored.parts) {
        state.inboxMailParts.add(part);
      }
    });
    return { id: row.id, outcome: 'found' };
  }
}
