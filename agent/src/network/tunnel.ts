import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { TLSSocket } from 'node:tls';
import { errorCategory, safeLog } from '../util/index.ts';
import { createAcmeIssuer, LETS_ENCRYPT_DIRECTORY } from '../../protocol/acme.ts';
import { CertificateKeeper, ChallengeResponses, type CertificateIssuer } from '../../protocol/certificates.ts';
import type { Signer } from '../../protocol/relay-client.ts';
import { TunnelClient, type TunnelStatus } from '../../protocol/tunnel-client.ts';
import { terminate } from '../../protocol/tunnel-terminator.ts';

export const TUNNEL_DIRECTORY = 'tunnel';
const CERT_CHECK_MS = 6 * 60 * 60 * 1000;
const CERT_RETRY_MS = 30 * 60 * 1000;

export interface TunnelServiceOptions {
  stateDirectory: string;
  relayUrl: () => string;
  signer: () => Signer | null;
  now: () => Date;
  acmeDirectory?: string;
  issuer?: (challenges: ChallengeResponses) => CertificateIssuer;
  ca?: string;
  relayAddress?: string;
  heartbeatMs?: number;
  deadMs?: number;
  backoffMinMs?: number;
}

export class TunnelService {
  readonly #options: TunnelServiceOptions;
  readonly #challenges = new ChallengeResponses();
  readonly #client: TunnelClient;
  #serve: ((socket: TLSSocket) => void) | null = null;
  #keeper: CertificateKeeper | null = null;
  #timer: NodeJS.Timeout | undefined;

  constructor(options: TunnelServiceOptions) {
    this.#options = options;
    this.#client = new TunnelClient({
      relayUrl: options.relayUrl,
      signer: options.signer,
      now: options.now,
      onHello: (host) => this.#hello(host),
      onWork: (socket) => terminate({ context: () => this.#keeper?.context() ?? null, challenges: this.#challenges,
        serve: (secure) => this.#serve?.(secure) }, socket),
      ...(options.ca === undefined ? {} : { ca: options.ca }),
      ...(options.relayAddress === undefined ? {} : { relayAddress: options.relayAddress }),
      ...(options.heartbeatMs === undefined ? {} : { heartbeatMs: options.heartbeatMs }),
      ...(options.deadMs === undefined ? {} : { deadMs: options.deadMs }),
      ...(options.backoffMinMs === undefined ? {} : { backoffMinMs: options.backoffMinMs }),
    });
  }

  status(): TunnelStatus {
    return this.#client.status();
  }

  certified(): boolean {
    return this.#keeper?.context() !== null && this.#keeper !== null;
  }

  start(serve: (socket: TLSSocket) => void): void {
    this.#serve = serve;
    this.#client.start();
  }

  wake(): void {
    this.#client.wake();
  }

  async stop(): Promise<void> {
    clearTimeout(this.#timer);
    this.#timer = undefined;
    await this.#client.stop();
  }

  ready(): boolean {
    return this.#keeper !== null && this.#keeper.context() !== null;
  }

  #issuer(): CertificateIssuer {
    if (this.#options.issuer !== undefined) {
      return this.#options.issuer(this.#challenges);
    }
    return createAcmeIssuer({ directoryUrl: this.#options.acmeDirectory ?? LETS_ENCRYPT_DIRECTORY,
      accountKeyFile: join(this.#options.stateDirectory, TUNNEL_DIRECTORY, 'acme-account.key.pem'),
      challenges: this.#challenges });
  }

  #hello(host: string): void {
    if (this.#keeper?.host === host) {
      this.#check();
      return;
    }
    const directory = join(this.#options.stateDirectory, TUNNEL_DIRECTORY);
    const keeper = new CertificateKeeper({ directory, host, issuer: this.#issuer(), now: this.#options.now });
    this.#keeper = keeper;
    mkdir(directory, { recursive: true, mode: 0o700 }).then(() => keeper.load()).then(() => this.#check(),
      (error: unknown) => {
        safeLog('warn', 'tunnel_certificate_failed', { category: errorCategory(error), error });
        this.#schedule(CERT_RETRY_MS);
      });
  }

  #schedule(delay: number): void {
    clearTimeout(this.#timer);
    this.#timer = setTimeout(() => this.#check(), delay);
    this.#timer.unref();
  }

  #check(): void {
    const keeper = this.#keeper;
    if (keeper === null) {
      return;
    }
    keeper.ensure().then((renewed) => {
      if (renewed) {
        safeLog('log', 'tunnel_certificate_renewed');
      }
      this.#schedule(CERT_CHECK_MS);
    }, (error: unknown) => {
      safeLog('warn', 'tunnel_certificate_failed', { category: errorCategory(error), error });
      this.#schedule(CERT_RETRY_MS);
    });
  }
}
