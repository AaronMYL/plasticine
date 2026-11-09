// SPDX-License-Identifier: Apache-2.0
// 实例这一头的 TLS 终结：隧道送来的是外面浏览器的原始字节（中继不解密）。看第一个字节——
// - 0x16（TLS 握手）：用这台实例自己的 <handle>.cyberhunter.top 证书解开，交给实例的 HTTP 服务；
// - 其余（中继 :80 转来的明文）：只回 ACME HTTP-01 验证，别的一律 404。
// 还没有证书时 TLS 连接直接关掉（证书签下来以前打不开，签的过程走的正是明文那一路）。

import type { Duplex } from 'node:stream';
import { TLSSocket, type SecureContext } from 'node:tls';
import type { ChallengeResponses } from './certificates.ts';
import { challengeToken, plainResponse, readRequestHead } from './http-head.ts';

const TLS_HANDSHAKE = 0x16;
// 明文那一路只有 ACME 验证：请求头几百字节，10 秒内到不齐就关。
const PLAIN_HEAD_TIMEOUT_MS = 10_000;

export interface TerminatorOptions {
  context: () => SecureContext | null;
  /** 解开的连接交给实例的 HTTP 服务（http.Server 的 'connection'）。 */
  serve: (socket: TLSSocket) => void;
  challenges: ChallengeResponses;
}

function answerPlain(options: TerminatorOptions, socket: Duplex): void {
  const chunks: Buffer[] = [];
  const timer = setTimeout(() => socket.destroy(), PLAIN_HEAD_TIMEOUT_MS);
  timer.unref();
  const onData = (chunk: Buffer): void => {
    chunks.push(chunk);
    const head = readRequestHead(Buffer.concat(chunks));
    if (head.state === 'more') {
      return;
    }
    clearTimeout(timer);
    socket.off('data', onData);
    const token = head.state === 'head' ? challengeToken(head.path) : null;
    const answer = token === null ? undefined : options.challenges.get(token);
    socket.end(answer === undefined ? plainResponse(404, 'not found') : plainResponse(200, answer));
  };
  socket.on('data', onData);
  socket.resume();
}

function answerTls(options: TerminatorOptions, socket: Duplex): void {
  const context = options.context();
  if (context === null) {
    socket.destroy();
    return;
  }
  const secure = new TLSSocket(socket, { isServer: true, secureContext: context, ALPNProtocols: ['http/1.1'] });
  // 握手失败（证书不被信任、对方断开）就是这条连接没了。
  secure.on('error', () => secure.destroy());
  secure.once('secure', () => options.serve(secure));
}

/** 接手一条对接好的工作连接。 */
export function terminate(options: TerminatorOptions, socket: Duplex): void {
  socket.on('error', () => socket.destroy());
  socket.once('data', (chunk: Buffer) => {
    socket.pause();
    socket.unshift(chunk);
    if (chunk[0] === TLS_HANDSHAKE) {
      answerTls(options, socket);
    } else {
      answerPlain(options, socket);
    }
  });
}
