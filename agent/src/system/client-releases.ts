// 界面现在是哪一版（设置里的版本号、界面每分钟查一次新版本）：读部署清单和部署脚本写的发布回执，两份对得上才算
// 这一版已经发布。发布、回退都由发布流程（安装包）做，这里只读。11-17：自迭代时代的「发布提请」（挑候选、预览、
// 提请发布或先不发）连同它的接口删了。

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

/** 一个文件现在的样子（改动时间和大小）；不在是 'none'。 */
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
  /** 上一次看到的部署清单和发布回执（改动时间和大小）：没变就不重读。 */
  #seen: string | null = null;
  constructor(options: ClientReleaseOptions) {
    this.#options = options;
  }
  /**
   * 看部署清单和发布回执有没有换。界面每分钟查一次新版本都会走到这里：两份文件都没变就什么都不做。
   */
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
  /** 界面查新版本要的那几样（现在这一版的版本号、时间、接口版本、一句说明）：不读库。 */
  version(): ClientVersion {
    return clientVersionOf({ current: this.#current, error: this.#error });
  }
}
