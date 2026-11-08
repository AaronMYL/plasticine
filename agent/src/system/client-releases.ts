// 客户端版本（设置 · 系统 ·「版本更新」）：读部署清单和部署脚本写的发布回执，登记每个构建、列发布历史、预览一个构建。
// 2026-11-05 Harness 重做：发布、回退不再经自迭代，改由发布流程（安装包）发；这里的「发布 / 回退」只回一句怎么做，
// 「先不」照旧记下。

import { existsSync } from 'node:fs';
import { readClientPreview } from './client-preview.ts';
import type {
  ClientManifest,
  ClientUpdatesResponse,
  ClientUpdateDecision,
  ClientUpdate,
} from '../../shared/api/index.ts';
import type { StateService } from '../state/index.ts';
import { StateError } from '../state/index.ts';
import { errorCategory, safeLog } from '../shared-log.ts';
import { manifestDigest, readClientManifest, readClientPublication } from './client-manifest.ts';
export interface ClientReleaseOptions {
  state: StateService;
  manifestPath: string | null;
  receiptPath: string;
  changed?: () => void;
}
export class ClientReleases {
  readonly #options: ClientReleaseOptions;
  #current: ClientManifest | null = null;
  #error: string | null = null;
  constructor(options: ClientReleaseOptions) {
    this.#options = options;
  }
  scan(): void {
    const { manifestPath, receiptPath, state } = this.#options;
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
