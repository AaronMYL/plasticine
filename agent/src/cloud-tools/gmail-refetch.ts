// mail.refetch（用户 2026-11-04 定：旧邮件从 Gmail 重新抓回补齐格式）在 Gmail 里找回一封：只读地 EXAMINE「所有邮件」
// （带 \All 标记的那个文件夹，名字随 Gmail 界面语言变），先按 Message-ID 找；旧版迁来的信 Message-ID 是旧格式，按发件人、
// 前后一天、再比对标题和时间找。找到的用 gmail-fetch.ts 整封抓回。不改已读、不动任何信。

import { errorCategory, safeLog } from '../shared-log.ts';
import { decodeHeaderWords } from './mail-words.ts';
import { fetchMessage, messageSizes, type ImapCommand } from './gmail-fetch.ts';
import { imapDate, imapQuote } from './mail-protocol.ts';
import { mailProtocolError } from './mail-wire.ts';
import type { RefetchResult, RefetchTarget } from './transports.ts';

// 找不到 \All 时的英文默认名。
const ALL_MAIL_DEFAULT = '[Gmail]/All Mail';
// 标准 Message-ID：<本地@域>。旧版的标识不是这个样子，按 Message-ID 找不到。
const STANDARD_MESSAGE_ID = /^<[^<>\s"]+@[^<>\s"]+>$/;
// 按发件人和日期找时最多看这么多封的信头（同一个发件人一天的信）。
const FALLBACK_CANDIDATES_MAX = 30;
// 旧版记的收信时间和 Gmail 信头时间相差在这之内才算同一封（同迁移 0052 合并重复的窗口）。
const SAME_MAIL_WINDOW_MS = 10 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

function unquote(name: string): string {
  if (!name.startsWith('"')) {
    return name;
  }
  return name.slice(1, -1).replace(/\\(.)/g, '$1');
}

/** LIST 里带 \All 的文件夹名（原样，可能是改过的 UTF-7）。 */
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

/** 按发件人、前后一天找，再逐封比对标题和信头时间。 */
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

// 中途出错时剩下那几封的结果（不带服务器原文）。
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

/**
 * 在一条已登录的连接上找回一批。中途出错：这一封和剩下的都记成出错（下次重跑再补），broken = true，调用方不再发
 * LOGOUT。
 */
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
