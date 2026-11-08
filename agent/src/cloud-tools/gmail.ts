// Gmail 最小 TLS 传输。凭据只在连接前读，固定收件人来自同一份文件，不输出原始异常。收信只读：BODY.PEEK、EXAMINE，
// 不改已读、不删、不动 Gmail 里的任何东西。
import { Type } from 'typebox';
import { Value } from 'typebox/value';
import type { CredentialFiles } from './credentials.ts';
import { CloudToolError } from './errors.ts';
import { fetchMessage, FULL_FETCH_MAX_BYTES, messageSizes, type ImapCommand } from './gmail-fetch.ts';
import { refetchMessages } from './gmail-refetch.ts';
import { imapDate, imapQuote, readImap, readSmtp, smtpData, SmtpRejection } from './mail-protocol.ts';
import { connectMailTls, MailWire, mailProtocolError, type MailConnect } from './mail-wire.ts';
import { SELF_MAIL_ADDRESS, type CloudTransports } from './transports.ts';

export const GMAIL_CREDENTIAL = 'gmail';
const RECENT_MS = 7 * 24 * 60 * 60 * 1000;
// 每批至多 50 封，交给 MailSync 连同游标落盘，避免七天邮件全抓完才保存进度。
const IMAP_BATCH_SIZE = 50;
const GmailCredentialSchema = Type.Object({
  address: Type.String({ pattern: '^[^\\s@<>"\\r\\n]{1,64}@[^\\s@<>"\\r\\n]{1,190}\\.[A-Za-z]{2,}$' }),
  appPassword: Type.String({ minLength: 1, maxLength: 200, pattern: '^[^\\r\\n\\u0000]+$' }),
}, { additionalProperties: false });

function readCredential(credentials: CredentialFiles) {
  if (credentials.status(GMAIL_CREDENTIAL) === 'missing') {
    throw new CloudToolError('not_configured', '收发邮件还没配置，请在服务器上放好 Gmail 凭据。');
  }
  const buffer = credentials.read(GMAIL_CREDENTIAL);
  try {
    const value: unknown = JSON.parse(buffer.toString('utf8'));
    if (!Value.Check(GmailCredentialSchema, value)) {
      throw mailProtocolError();
    }
    return value;
  } catch {
    throw new CloudToolError('failed', 'Gmail 配置格式不对，请检查服务器上的凭据文件。');
  } finally {
    buffer.fill(0);
  }
}

export interface GmailOptions {
  credentials: CredentialFiles;
  connect?: MailConnect;
  now?: () => Date;
}

// 一次收信的总字节上限：收信 90 秒的时限里按 1 MB/s 的保守下载速度留余量；超出的留给下一轮（至少抓一封）。
const BATCH_MAX_BYTES = 32 * 1024 * 1024;

/** 连上、登录、做事、登出；连接上的任何错误都换成不带服务器原文的固定错误。 */
async function withImap<T>(dial: MailConnect, credentials: CredentialFiles, signal: AbortSignal,
  work: (command: ImapCommand) => Promise<{ value: T; logout: boolean }>): Promise<T> {
  signal.throwIfAborted();
  const credential = readCredential(credentials);
  let wire: MailWire | undefined;
  try {
    wire = new MailWire(await dial({ host: 'imap.gmail.com', port: 993 }, signal), signal);
    if (!/^\* OK\b/.test(await wire.line())) {
      throw mailProtocolError();
    }
    let seq = 0;
    const command: ImapCommand = async (text) => {
      const tag = `A${++seq}`;
      wire?.write(`${tag} ${text}\r\n`);
      return readImap(wire as MailWire, tag);
    };
    await command(`LOGIN ${imapQuote(credential.address)} ${imapQuote(credential.appPassword)}`);
    const done = await work(command);
    if (done.logout) {
      await command('LOGOUT');
    }
    return done.value;
  } catch {
    throw mailProtocolError();
  } finally {
    wire?.close();
  }
}

/** 这一批里按大小留够一次收信抓得完的那几封（至少一封）。 */
function withinBudget(uids: readonly number[], sizes: Map<number, number>): number[] {
  const kept: number[] = [];
  let total = 0;
  for (const uid of uids) {
    const size = Math.min(sizes.get(uid) ?? 0, FULL_FETCH_MAX_BYTES);
    if (kept.length > 0 && total + size > BATCH_MAX_BYTES) {
      break;
    }
    kept.push(uid);
    total += size;
  }
  return kept;
}

export function createGmailTransports(options: GmailOptions): Pick<CloudTransports, 'imap' | 'mail'> {
  const dial = options.connect ?? connectMailTls;
  const now = options.now ?? (() => new Date());
  return {
    imap: {
      fetch(_account, cursor, signal) {
        return withImap(dial, options.credentials, signal, async (command) => {
          const selected = await command('SELECT INBOX');
          const uidValidity = Number(/\[UIDVALIDITY (\d+)\]/.exec(selected.lines.join('\n'))?.[1]);
          if (!Number.isSafeInteger(uidValidity) || uidValidity < 1) {
            throw mailProtocolError();
          }
          const lastUid = cursor.uidValidity === uidValidity ? (cursor.lastUid ?? 0) : 0;
          const search = lastUid > 0 ? `UID ${lastUid + 1}:*`
            : `SINCE ${imapDate(new Date(now().getTime() - RECENT_MS))}`;
          const searched = await command(`UID SEARCH ${search}`);
          const uids = searched.lines.filter((line) => line.startsWith('* SEARCH'))
            .flatMap((line) => line.slice(8).trim().split(/\s+/).filter(Boolean).map(Number));
          if (uids.some((uid) => !Number.isSafeInteger(uid) || uid < 1)) {
            throw mailProtocolError();
          }
          // n:* 在 n 大于邮箱最大 UID 时会反向包含旧 UID，必须再次排除。
          const candidates = [...new Set(uids)].filter((uid) => uid > lastUid).sort((a, b) => a - b)
            .slice(0, IMAP_BATCH_SIZE);
          const sizes = await messageSizes(command, candidates);
          const messages = [];
          for (const uid of withinBudget(candidates, sizes)) {
            messages.push(await fetchMessage(command, uid, sizes.get(uid) ?? 0));
          }
          return { value: { uidValidity, messages }, logout: true };
        });
      },
      refetch(_account, targets, signal) {
        return withImap(dial, options.credentials, signal, async (command) => {
          const { results, broken } = await refetchMessages(command, targets, signal);
          return { value: results, logout: !broken };
        });
      },
    },
    mail: {
      async send(_account, input, signal) {
        signal.throwIfAborted();
        const credential = readCredential(options.credentials);
        // 寄给自己的通知换成凭据里的地址；站内信回复（第 113 条，用户点了发送）寄回原发件人。
        const recipient = input.to === SELF_MAIL_ADDRESS ? credential.address : input.to;
        const data = smtpData(credential.address, input.subject, input.text, input.inReplyTo, recipient);
        let wire: MailWire | undefined;
        let startedData = false;
        let accepted = false;
        try {
          wire = new MailWire(await dial({ host: 'smtp.gmail.com', port: 465 }, signal), signal);
          await readSmtp(wire, [220]);
          const command = async (text: string, codes: number[]) => {
            wire?.write(text + '\r\n');
            await readSmtp(wire as MailWire, codes);
          };
          await command('EHLO plasticine', [250]);
          const auth = Buffer.from(`\0${credential.address}\0${credential.appPassword}`);
          try {
            await command(`AUTH PLAIN ${auth.toString('base64')}`, [235, 250]);
          } finally {
            auth.fill(0);
          }
          await command(`MAIL FROM:<${credential.address}>`, [250]);
          await command(`RCPT TO:<${recipient}>`, [250, 251]);
          await command('DATA', [354]);
          startedData = true;
          wire.write(data);
          await readSmtp(wire, [250]);
          accepted = true;
          await command('QUIT', [221]);
        } catch (error) {
          if (!accepted) {
            const unknown = startedData && !(error instanceof SmtpRejection);
            throw new CloudToolError(unknown ? 'unknown' : 'failed',
              unknown ? '邮件发送结果待核实，请先检查自己的收件箱。' : '邮件没有发出，请检查 Gmail 配置后再试。');
          }
          // DATA 已有 250 回执，QUIT 断开也不能触发重复投递。
        } finally {
          wire?.close();
        }
      },
    },
  };
}
