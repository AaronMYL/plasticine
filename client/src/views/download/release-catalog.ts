import { parseReleaseManifest, type ReleaseAsset, type ReleaseManifest }
  from '../../../../agent/shared/release-manifest.ts';

export const DOWNLOAD_ASSET_KEYS = ['mac', 'windows', 'linuxInstaller', 'server'] as const;
type AssetKey = typeof DOWNLOAD_ASSET_KEYS[number];
export interface DownloadCatalog {
  manifest: ReleaseManifest;
  assets: Record<AssetKey, ReleaseAsset>;
}

const LOCAL = new Set(['localhost', '127.0.0.1', '[::1]']);
const FILE_NAME = /^[A-Za-z0-9_-][A-Za-z0-9._-]*$/;

/** 四个真实包齐备才给下载动作；不能从版本号或平台名字猜文件地址。 */
export function parseDownloadCatalog(text: string, manifestUrl: string): DownloadCatalog {
  const manifest = parseReleaseManifest(text);
  const resolved: Partial<Record<AssetKey, ReleaseAsset>> = {};
  for (const key of DOWNLOAD_ASSET_KEYS) {
    const asset = manifest.assets[key];
    if (asset === undefined) throw new Error('安装包还没有齐备。');
    const url = new URL(asset.url, manifestUrl);
    const permitted = url.protocol === 'https:' || (url.protocol === 'http:' && LOCAL.has(url.hostname));
    if (!permitted || url.username !== '' || url.password !== '' || !FILE_NAME.test(asset.name)) {
      throw new Error('清单中的下载地址格式不对。');
    }
    resolved[key] = { ...asset, url: url.href };
  }
  return { manifest, assets: resolved as Record<AssetKey, ReleaseAsset> };
}

/** 只生成供用户复制的命令；URL 取自已经核验的安装脚本资产，不执行它。 */
export function linuxInstallCommand(catalog: DownloadCatalog): string {
  const quoted = `'${catalog.assets.linuxInstaller.url.replace(/'/g, "'\\''")}'`;
  return `curl -fsSL ${quoted} | sudo sh`;
}

export function existingInstanceUrl(input: string): string {
  const value = input.trim();
  if (value === '') throw new Error('先填入 Plasticine 地址。');
  const hasScheme = /^[a-z][a-z0-9+.-]*:/i.test(value);
  let url: URL;
  try {
    url = new URL(hasScheme ? value : `https://${value}`);
  } catch (cause) {
    if (cause instanceof TypeError) throw new Error('地址不完整，请核对后再打开。');
    throw cause;
  }
  if (!['http:', 'https:'].includes(url.protocol) || url.username !== '' || url.password !== '') {
    throw new Error('请填写不带账号密码的 http 或 https 地址。');
  }
  return url.href;
}
