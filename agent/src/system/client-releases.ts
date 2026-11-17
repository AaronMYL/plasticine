// 客户端版本（设置 · 系统 ·「版本更新」）：读部署清单和部署脚本写的发布回执，登记每个构建、列发布历史、预览一个构建。
// 2026-11-05 Harness 重做：发布、回退不再经自迭代，改由发布流程（安装包）发；这里的「发布 / 回退」只回一句怎么做，
// 「先不」照旧记下。

import { existsSync, statSync } from 'node:fs';
import { readClientPreview } from './client-preview.ts';
import {
  clientVersionOf,
  type ClientManifest,
  type ClientUpdatesResponse,
  type ClientUpdateDecision,
  type ClientUpdate,
  type ClientVersion,
} from '../../shared/api/index.ts';
import { StateError, type StateService } from '../state/index.ts';
import { errorCategory, safeLog } from '../util/index.ts';
import { manifestDigest, readClientManifest, readClientPublication } from './client-manifest.ts';
export interface ClientReleaseOptions {
  state: StateService;
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
  /** 上一次看到的部署清单和发布回执（改动时间和大小）：没变就不重读、不重登记。 */
  #seen: string | null = null;
  constructor(options: ClientReleaseOptions) {
    this.#options = options;
  }
  /**
   * 看部署清单和发布回执有没有换。界面每分钟查一次新版本都会走到这里：两份文件都没变就什么都不做（11-17：原来每次都
   * 重读清单、重新登记、重查整张表）。
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
      state.clientUpdates.register(manifest);
      if (!existsSync(receiptPath)) {
        return;
      }
      const receipt = readClientPublication(receiptPath);
      if (receipt.buildId !== manifest.buildId || receipt.manifestDigest !== manifestDigest(manifest)) {
        return;
      }
      const added = state.clientUpdates.publish(receipt);
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
    return clientVersionOf({ current: this.#current, error: this.#error, channelReady: false, updates: [],
      history: [] });
  }
  view(): ClientUpdatesResponse {
    return {
      current: this.#current,
      error: this.#error,
      channelReady: false,
      updates: this.#options.state.clientUpdates.list(),
      history: this.#options.state.clientUpdates.history(),
    };
  }
  preview(id: string, file: string) {
    return readClientPreview(this.#options.manifestPath, this.#options.state.clientUpdates.require(id).manifest, file);
  }
  decide(id: string, input: ClientUpdateDecision): ClientUpdate {
    const { state } = this.#options;
    const row = state.clientUpdates.require(id);
    if (id !== input.targetBuildId || input.currentBuildId !== (this.#current?.buildId ?? null)) {
      throw new StateError('version_conflict', '当前发布版本已变，请重新查看。');
    }
    if (input.decision === 'defer') {
      return state.clientUpdates.update(id, { status: 'deferred' });
    }
    if (row.manifest.protocol.min > 2 || row.manifest.protocol.max < 2) {
      throw new StateError('invalid_input', '目标版本与当前协议不兼容。');
    }
    throw new StateError('invalid_input', '客户端现在由发布流程（安装包）发布和回退，这里不能直接发。');
  }
}
