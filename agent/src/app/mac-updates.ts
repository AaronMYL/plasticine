// Mac 自更新的两个节点接口（shared/api/mac-updates.ts）：读状态目录 downloads/mac/latest.json，回版本、校验值和
// 同源下载地址；下载只给 latest.json 里写的那一个包（文件名对不上就 404，路径里带不进目录）。两个都用节点 Bearer。
// 包由安装包的统一发布写进来（scripts/publish-mac-update.ts）；这里只读，不写。
// 没有 latest.json = 还没发布过，404；写坏了 = 503 并记日志，不给半截信息。

import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { Value } from 'typebox/value';
import {
  MAC_DOWNLOADS_PATH,
  MacPackageFileSchema,
  MacReleaseFileSchema,
  type MacLatestResponse,
  type MacReleaseFile,
} from '../../shared/api/index.ts';
import { errorCategory, safeLog } from '../shared-log.ts';
import { ApiError } from './api-error.ts';
import { param, type Reply, type RequestContext } from './context.ts';
import { requireNode } from './node-protocol.ts';

/** 状态目录下放 Mac 包的地方（发布 job 和这里共用这两个名字）。 */
export const MAC_DOWNLOADS_DIR = join('downloads', 'mac');
export const MAC_LATEST_FILE = 'latest.json';

export interface MacDownloadsOptions {
  /** <状态目录>/downloads/mac */
  directory: string;
  /** 服务器的公开地址（config.ts publicUrlFromEnv），下载地址和它同源。 */
  publicUrl: string;
}

function noPackage(): ApiError {
  return new ApiError(404, 'not_found', '服务器上还没有可用的 Mac 包。', {
    next: '等下一次 Mac 构建发布之后再查；App 会每 6 小时自己查一次。',
  });
}

function isMissing(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}

export class MacDownloads {
  readonly #options: MacDownloadsOptions;

  constructor(options: MacDownloadsOptions) {
    this.#options = options;
  }

  /** 现在的那一个包；没发布过是 null。latest.json 坏了、或指的 zip 不在，抛 ApiError。 */
  async latest(): Promise<MacReleaseFile | null> {
    let text: string;
    try {
      text = await readFile(join(this.#options.directory, MAC_LATEST_FILE), 'utf8');
    } catch (error) {
      if (isMissing(error)) {
        return null;
      }
      throw error;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch (error) {
      safeLog('error', 'mac_latest_invalid', { category: errorCategory(error) });
      throw this.#broken();
    }
    if (!Value.Check(MacReleaseFileSchema, parsed)) {
      safeLog('error', 'mac_latest_invalid', {});
      throw this.#broken();
    }
    try {
      await stat(join(this.#options.directory, parsed.file));
    } catch (error) {
      if (isMissing(error)) {
        safeLog('warn', 'mac_package_missing', {});
        throw noPackage();
      }
      throw error;
    }
    return parsed;
  }

  url(release: MacReleaseFile): string {
    return `${this.#options.publicUrl}${MAC_DOWNLOADS_PATH}/${encodeURIComponent(release.file)}`;
  }

  async bytes(release: MacReleaseFile): Promise<Buffer> {
    return readFile(join(this.#options.directory, release.file));
  }

  #broken(): ApiError {
    return new ApiError(503, 'unavailable', '服务器上的 Mac 包信息坏了，这次没有给出更新。', {
      next: '重新跑一次 Mac 构建的发布；当前版本照常能用。',
    });
  }
}

function downloads(context: RequestContext): MacDownloads {
  const service = context.deps.macDownloads;
  if (service === null) {
    throw noPackage();
  }
  return service;
}

/** GET /v2/nodes/mac/latest */
export async function getMacLatest(context: RequestContext): Promise<Reply> {
  requireNode(context);
  const service = downloads(context);
  const release = await service.latest();
  if (release === null) {
    throw noPackage();
  }
  const body: MacLatestResponse = { version: release.version, sha256: release.sha256, url: service.url(release) };
  return { status: 200, body, headers: { 'cache-control': 'no-store' } };
}

/** GET /v2/nodes/mac/downloads/:file */
export async function getMacDownload(context: RequestContext): Promise<Reply> {
  requireNode(context);
  const file = param(context, 'file');
  const service = downloads(context);
  const release = Value.Check(MacPackageFileSchema, file) ? await service.latest() : null;
  if (release === null || release.file !== file) {
    throw noPackage();
  }
  const data = await service.bytes(release);
  return { status: 200, bytes: { data, type: 'application/zip', download: release.file, noStore: true } };
}
