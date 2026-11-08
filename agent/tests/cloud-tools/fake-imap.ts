// 假的 IMAP / SMTP 服务器（本机回环，不连外网、没有真邮箱）：按行收命令、按协议回包，记下收到的命令（LOGIN 那一行
// 换成占位）。IMAP 这边认收信和重抓用到的那几种命令；信是手写的样本。

import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { connect, createServer, type Socket } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CredentialFiles } from '../../src/cloud-tools/credentials.ts';

export async function fakeServer(greeting: string, answer: (line: string, socket: Socket) => void) {
  const sockets = new Set<Socket>();
  const server = createServer((socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
    socket.on('error', () => socket.destroy());
    socket.write(greeting);
    let buffer = '';
    socket.on('data', (chunk) => {
      buffer += chunk.toString();
      let end: number;
      while ((end = buffer.indexOf('\r\n')) >= 0) {
        const line = buffer.slice(0, end);
        buffer = buffer.slice(end + 2);
        answer(line, socket);
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address !== null && typeof address !== 'string');
  return {
    dial: async () => connect(address.port, '127.0.0.1'),
    close: async () => {
      for (const socket of sockets) {
        socket.destroy();
      }
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

export function fixture() {
  const directory = mkdtempSync(join(tmpdir(), 'plasticine-gmail-'));
  const credentials = new CredentialFiles(directory, false);
  const put = () => writeFileSync(join(directory, 'gmail'), JSON.stringify({
    address: 'self@example.test', appPassword: 'test-placeholder',
  }));
  return { credentials, put, close: () => rmSync(directory, { recursive: true, force: true }) };
}

export interface FakeMessage {
  uid: number;
  raw: string;
  /** 报给 RFC822.SIZE 的大小（默认是 raw 的字节数）。 */
  size?: number;
  /** 太大的信要用到：BODYSTRUCTURE 和各分段（键是分段号，含 n.MIME）。 */
  structure?: string;
  sections?: Record<string, string>;
}

export interface FakeBox {
  validity: number;
  messages: FakeMessage[];
  /** UID SEARCH UID / SINCE 回的 UID（默认全部）。 */
  uids?: number[];
  /** 「所有邮件」的名字（LIST 里带 \All 的那个）。 */
  allMail?: string;
}

function literal(section: string, data: string): string {
  return `BODY[${section}] {${Buffer.byteLength(data)}}\r\n${data}`;
}

function headerOf(raw: string): string {
  const end = raw.indexOf('\r\n\r\n');
  return end < 0 ? raw : raw.slice(0, end + 4);
}

function headerField(raw: string, name: string): string {
  const unfolded = headerOf(raw).replace(/\r\n[ \t]+/g, ' ');
  return new RegExp(`^${name}:\\s*(.*)$`, 'im').exec(unfolded)?.[1] ?? '';
}

function fetchReply(message: FakeMessage, line: string): string {
  const items: string[] = [`UID ${message.uid}`];
  if (line.includes('RFC822.SIZE')) {
    items.push(`RFC822.SIZE ${message.size ?? Buffer.byteLength(message.raw)}`);
  }
  if (line.includes('BODY.PEEK[]')) {
    items.push(literal('', message.raw));
  }
  if (line.includes('BODY.PEEK[HEADER.FIELDS (SUBJECT DATE)]')) {
    const subject = headerField(message.raw, 'subject');
    const fields = `Subject: ${subject}\r\nDate: ${headerField(message.raw, 'date')}\r\n\r\n`;
    items.push(literal('HEADER.FIELDS (SUBJECT DATE)', fields));
  }
  if (line.includes('BODY.PEEK[HEADER]')) {
    items.push(literal('HEADER', headerOf(message.raw)));
  }
  if (line.includes('BODYSTRUCTURE')) {
    items.push(`BODYSTRUCTURE ${message.structure ?? '("TEXT" "PLAIN" NIL NIL NIL "7BIT" 4 1)'}`);
  }
  for (const match of line.matchAll(/BODY\.PEEK\[([0-9.]+(?:\.MIME)?|TEXT)\]/g)) {
    const section = match[1] ?? '';
    items.push(literal(section, message.sections?.[section] ?? ''));
  }
  return `* 1 FETCH (${items.join(' ')})\r\n`;
}

function searchReply(box: FakeBox, line: string): string {
  const byId = /HEADER Message-ID "([^"]*)"/.exec(line)?.[1];
  const byFrom = /SEARCH FROM "([^"]*)"/.exec(line)?.[1];
  let uids: number[];
  if (byId !== undefined) {
    uids = box.messages.filter((message) => headerField(message.raw, 'message-id') === byId)
      .map((message) => message.uid);
  } else if (byFrom !== undefined) {
    uids = box.messages.filter((message) => headerField(message.raw, 'from').toLowerCase()
      .includes(byFrom.toLowerCase())).map((message) => message.uid);
  } else {
    uids = box.uids ?? box.messages.map((message) => message.uid);
  }
  return `* SEARCH ${uids.join(' ')}\r\n`;
}

/** 一个假的 Gmail IMAP：收件箱和「所有邮件」是同一堆信。 */
export async function fakeImap(box: FakeBox) {
  const commands: string[] = [];
  const fake = await fakeServer('* OK ready\r\n', (line, socket) => {
    socket.setNoDelay(true);
    commands.push(line.replace(/LOGIN .*/, 'LOGIN [omitted]'));
    const tag = line.split(' ')[0];
    if (/ (SELECT|EXAMINE) /.test(line)) {
      socket.write(`* OK [UIDVALIDITY ${box.validity}] valid\r\n`);
    } else if (line.includes(' LIST ')) {
      socket.write('* LIST (\\HasNoChildren) "/" "INBOX"\r\n');
      socket.write(`* LIST (\\HasNoChildren \\All) "/" "${box.allMail ?? '[Gmail]/All Mail'}"\r\n`);
    } else if (line.includes('UID SEARCH')) {
      socket.write(searchReply(box, line));
    } else if (line.includes('UID FETCH')) {
      const uids = (/UID FETCH ([0-9,]+)/.exec(line)?.[1] ?? '').split(',').map(Number);
      for (const message of box.messages.filter((entry) => uids.includes(entry.uid))) {
        socket.write(fetchReply(message, line));
      }
    }
    socket.write(`${tag} OK done\r\n`);
  });
  return { ...fake, commands };
}
