import { parseReleaseManifest, type ReleaseAsset } from '../../../../agent/shared/release-manifest.ts';
import { parseDesktopManifest } from '../../../../agent/shared/desktop-release.ts';

const LOCAL = new Set(['localhost', '127.0.0.1', '[::1]']);
const FILE_NAME = /^[A-Za-z0-9_-][A-Za-z0-9._-]*$/;

function checkedAsset(asset: ReleaseAsset, manifestUrl: string): ReleaseAsset {
  const url = new URL(asset.url, manifestUrl);
  const permitted = url.protocol === 'https:' || (url.protocol === 'http:' && LOCAL.has(url.hostname));
  if (!permitted || url.username !== '' || url.password !== '' || !FILE_NAME.test(asset.name)) {
    throw new Error('清单中的下载地址格式不对。');
  }
  return { ...asset, url: url.href };
}

export interface DesktopCatalog {
  version: string;
  mac: ReleaseAsset | null;
  windows: ReleaseAsset | null;
}

export function parseDesktopCatalog(text: string, manifestUrl: string): DesktopCatalog {
  const manifest = parseDesktopManifest(text);
  const mac = manifest.assets.macDisk ?? manifest.assets.mac;
  const windows = manifest.assets.windows;
  if (mac === undefined && windows === undefined) throw new Error('桌面客户端还没有安装包。');
  return { version: manifest.version, mac: mac === undefined ? null : checkedAsset(mac, manifestUrl),
    windows: windows === undefined ? null : checkedAsset(windows, manifestUrl) };
}

export function shortVersion(version: string): string {
  return version.split('.').slice(0, 2).join('.');
}

export function parseLinuxCommand(text: string, manifestUrl: string): string {
  const asset = parseReleaseManifest(text).assets.linuxInstaller;
  if (asset === undefined) throw new Error('Linux 安装脚本还没有。');
  const url = checkedAsset(asset, manifestUrl).url;
  return `curl -fsSL '${url.replace(/'/g, "'\\''")}' | sudo sh`;
}
