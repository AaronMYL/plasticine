import { existsSync, statSync } from 'node:fs';
import { clientVersionOf, type ClientManifest, type ClientVersion } from '../../shared/api/index.ts';
import type { StateService } from '../state/index.ts';
import { errorCategory, safeLog } from '../util/index.ts';
import { manifestDigest, readClientManifest, readClientPublication } from './client-manifest.ts';

export interface ClientReleaseOptions {
  state: Pick<StateService, 'clientPublications'>;
  manifestPath: string | null;
  receiptPath: string;
  changed?: () => void;
}

function stamp(path: string | null): string {
  if (path === null || !existsSync(path)) {
    return 'none';
  }
  const info = statSync(path);
  return `${info.mtimeMs}:${info.size}`;
}

export class ClientReleases {
  readonly #options: ClientReleaseOptions;
  #current: ClientManifest | null = null;
  #error: string | null = null;
  #seen: string | null = null;
  constructor(options: ClientReleaseOptions) {
    this.#options = options;
  }
  scan(): void {
    const { manifestPath, receiptPath, state } = this.#options;
    const seen = `${stamp(manifestPath)}|${stamp(receiptPath)}`;
    if (seen === this.#seen) {
      return;
    }
    this.#seen = seen;
    this.#current = null;
    this.#error = null;
    if (manifestPath === null || !existsSync(manifestPath)) {
      return;
    }
    try {
      const manifest = readClientManifest(manifestPath);
      if (!existsSync(receiptPath)) {
        return;
      }
      const receipt = readClientPublication(receiptPath);
      if (receipt.buildId !== manifest.buildId || receipt.manifestDigest !== manifestDigest(manifest)) {
        return;
      }
      const added = state.clientPublications.publish(receipt);
      this.#current = manifest;
      if (added) {
        this.#options.changed?.();
      }
    } catch (error) {
      safeLog('warn', 'client_release_invalid', { category: errorCategory(error) });
      this.#error = '客户端发布记录校验失败，请检查部署清单。';
    }
  }
  version(): ClientVersion {
    return clientVersionOf({ current: this.#current, error: this.#error });
  }
}
