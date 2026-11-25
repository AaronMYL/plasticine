// SPDX-License-Identifier: Apache-2.0

import type { Duplex } from 'node:stream';
import { TLSSocket, type SecureContext } from 'node:tls';
import type { ChallengeResponses } from './certificates.ts';
import { challengeToken, plainResponse, readRequestHead } from './http-head.ts';

const TLS_HANDSHAKE = 0x16;
const PLAIN_HEAD_TIMEOUT_MS = 10_000;

export interface TerminatorOptions {
  context: () => SecureContext | null;
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
  secure.on('error', () => secure.destroy());
  secure.once('secure', () => options.serve(secure));
}

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
