import { errorCategory, safeLog } from '../util/index.ts';
import { decodeHeaderWords } from './mail-words.ts';
import { fetchMessage, messageSizes, type ImapCommand } from './gmail-fetch.ts';
import { imapDate, imapQuote } from './mail-protocol.ts';
import { mailProtocolError } from './mail-wire.ts';
import type { RefetchResult, RefetchTarget } from './transports.ts';

const ALL_MAIL_DEFAULT = '[Gmail]/All Mail';
const STANDARD_MESSAGE_ID = /^<[^<>\s"]+@[^<>\s"]+>$/;
const FALLBACK_CANDIDATES_MAX = 30;
const SAME_MAIL_WINDOW_MS = 10 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

function unquote(name: string): string {
  if (!name.startsWith('"')) {
    return name;
  }
  return name.slice(1, -1).replace(/\\(.)/g, '$1');
}

export function allMailbox(lines: readonly string[]): string {
  for (const line of lines) {
    const match = /^\* LIST \(([^)]*)\) (?:"(?:[^"\\]|\\.)*"|NIL) (.+)$/i.exec(line);
    if (match !== null && /(?:^|\s)\\All(?:\s|$)/i.test(match[1] ?? '')) {
      return unquote((match[2] ?? '').trim());
    }
  }
  return ALL_MAIL_DEFAULT;
}

function searchUids(lines: readonly string[]): number[] {
  return lines.filter((line) => line.startsWith('* SEARCH'))
    .flatMap((line) => line.slice(8).trim().split(/\s+/).filter(Boolean).map(Number))
    .filter((uid) => Number.isSafeInteger(uid) && uid > 0);
}

function sameTitle(subject: string, title: string): boolean {
  const normalize = (text: string) => text.replace(/\s+/g, ' ').trim();
  return normalize(subject) === normalize(title);
}

async function findByLook(command: ImapCommand, target: RefetchTarget): Promise<number | null> {
  const at = Date.parse(target.receivedAt);
  if (Number.isNaN(at) || target.fromAddress.trim() === '') {
    return null;
  }
  const since = imapDate(new Date(at - DAY_MS));
  const before = imapDate(new Date(at + 2 * DAY_MS));
  const searched = await command(`UID SEARCH FROM ${imapQuote(target.fromAddress.trim())} SINCE ${since}`
    + ` BEFORE ${before}`);
  const uids = searchUids(searched.lines).slice(-FALLBACK_CANDIDATES_MAX);
  for (const uid of uids) {
    const response = await command(`UID FETCH ${uid} (BODY.PEEK[HEADER.FIELDS (SUBJECT DATE)])`);
    const header = response.literals[0]?.data.toString('utf8') ?? '';
    const unfolded = header.replace(/\r?\n[ \t]+/g, ' ');
    const subject = decodeHeaderWords(/^subject:\s*(.*)$/im.exec(unfolded)?.[1] ?? '');
    const date = Date.parse(/^date:\s*(.*)$/im.exec(unfolded)?.[1] ?? '');
    if (sameTitle(subject, target.title) && !Number.isNaN(date) && Math.abs(date - at) < SAME_MAIL_WINDOW_MS) {
      return uid;
    }
  }
  return null;
}

async function findUid(command: ImapCommand, target: RefetchTarget): Promise<number | null> {
  const messageId = target.messageId?.trim() ?? '';
  if (STANDARD_MESSAGE_ID.test(messageId)) {
    const searched = await command(`UID SEARCH HEADER Message-ID ${imapQuote(messageId)}`);
    const uid = searchUids(searched.lines)[0];
    if (uid !== undefined) {
      return uid;
    }
  }
  return findByLook(command, target);
}

const BROKEN = '找的过程中邮件连接断了，这一封没补；下次重跑再补。';

async function refetchOne(command: ImapCommand, target: RefetchTarget, mailbox: string,
  uidValidity: number): Promise<RefetchResult> {
  const uid = await findUid(command, target);
  if (uid === null) {
    return { kind: 'not_found' };
  }
  const size = (await messageSizes(command, [uid])).get(uid) ?? 0;
  return { kind: 'found', mail: await fetchMessage(command, uid, size), uidValidity, mailbox };
}

export async function refetchMessages(command: ImapCommand, targets: readonly RefetchTarget[],
  signal: AbortSignal): Promise<{ results: RefetchResult[]; broken: boolean }> {
  const listed = await command('LIST "" "*"');
  const mailbox = allMailbox(listed.lines);
  const examined = await command(`EXAMINE ${imapQuote(mailbox)}`);
  const uidValidity = Number(/\[UIDVALIDITY (\d+)\]/.exec(examined.lines.join('\n'))?.[1]);
  if (!Number.isSafeInteger(uidValidity) || uidValidity < 1) {
    throw mailProtocolError();
  }
  const results: RefetchResult[] = [];
  for (const target of targets) {
    try {
      signal.throwIfAborted();
      results.push(await refetchOne(command, target, mailbox, uidValidity));
    } catch (error) {
      safeLog('warn', 'mail_refetch_broken', { category: errorCategory(error) });
      while (results.length < targets.length) {
        results.push({ kind: 'error', message: BROKEN });
      }
      return { results, broken: true };
    }
  }
  return { results, broken: false };
}
