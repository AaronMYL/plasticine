// 按字节读 IMAP literal、按行读 SMTP；所有网络异常只转换成固定错误，不带认证回包。
import { connect } from 'node:tls';
import type { Duplex } from 'node:stream';
import { CloudToolError } from './errors.ts';

// 最小邮件传输不下载大附件；超过 8 MiB 的单次回包停止并留给下一轮报告。
const MAX_BUFFER_BYTES = 8 * 1024 * 1024;
const MAX_LINE_BYTES = 64 * 1024;
export interface MailEndpoint { host: string; port: number }
export type MailConnect = (endpoint: MailEndpoint, signal: AbortSignal) => Promise<Duplex>;

export const connectMailTls: MailConnect = async (endpoint, signal) => {
  signal.throwIfAborted();
  return connect({ ...endpoint, servername: endpoint.host, rejectUnauthorized: true });
};

export function mailProtocolError(): CloudToolError {
  return new CloudToolError('failed', '邮件连接或协议校验失败，请检查配置后再试。');
}

export class MailWire {
  readonly #socket: Duplex;
  readonly #signal: AbortSignal;
  #buffer: Buffer = Buffer.alloc(0);
  #ended = false;
  #wake: (() => void) | null = null;
  readonly #abort = (): void => {
    this.#ended = true;
    this.#socket.destroy();
    this.#wake?.();
  };

  constructor(socket: Duplex, signal: AbortSignal) {
    this.#socket = socket;
    this.#signal = signal;
    socket.on('data', (chunk: Buffer) => {
      if (this.#buffer.length + chunk.length > MAX_BUFFER_BYTES) {
        this.#abort();
        return;
      }
      this.#buffer = Buffer.concat([this.#buffer, chunk]);
      this.#wake?.();
    });
    socket.on('error', this.#abort);
    socket.on('close', this.#abort);
    socket.on('end', this.#abort);
    signal.addEventListener('abort', this.#abort, { once: true });
    if (signal.aborted) {
      this.#abort();
    }
  }

  write(text: string): void {
    if (this.#ended || this.#signal.aborted) {
      throw mailProtocolError();
    }
    this.#socket.write(text);
  }

  async #more(): Promise<void> {
    if (this.#ended || this.#signal.aborted) {
      throw mailProtocolError();
    }
    await new Promise<void>((resolve) => { this.#wake = resolve; });
    this.#wake = null;
  }

  async line(): Promise<string> {
    for (;;) {
      const end = this.#buffer.indexOf('\r\n');
      if (end >= 0) {
        const line = this.#buffer.subarray(0, end).toString('utf8');
        this.#buffer = this.#buffer.subarray(end + 2);
        return line;
      }
      if (this.#buffer.length > MAX_LINE_BYTES) {
        throw mailProtocolError();
      }
      await this.#more();
    }
  }

  async literal(bytes: number): Promise<Buffer> {
    if (!Number.isSafeInteger(bytes) || bytes < 0 || bytes > MAX_BUFFER_BYTES) {
      throw mailProtocolError();
    }
    while (this.#buffer.length < bytes) {
      await this.#more();
    }
    const result = this.#buffer.subarray(0, bytes);
    this.#buffer = this.#buffer.subarray(bytes);
    return result;
  }

  close(): void {
    this.#signal.removeEventListener('abort', this.#abort);
    this.#abort();
  }
}
