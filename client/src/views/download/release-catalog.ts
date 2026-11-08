import { parseReleaseManifest, type ReleaseAsset } from '../../../../agent/shared/release-manifest.ts';
import { parseDesktopManifest } from '../../../../agent/shared/desktop-release.ts';

// 下载页读的两份发布清单（11-08）：desktop.json 给桌面客户端（主下载），manifest.json 只取 Linux 安装脚本。
// 地址都先核过（https、不带账号密码、文件名老实），不从版本号或平台名猜地址。

const LOCAL = new Set(['localhost', '127.0.0.1', '[::1]']);
const FILE_NAME = /^[A-Za-z0-9_-][A-Za-z0-9._-]*$/;

/** 清单里的一个包：地址只认 https（本机开发认 http 的本机地址），不带账号密码，文件名老实。 */
function checkedAsset(asset: ReleaseAsset, manifestUrl: string): ReleaseAsset {
  const url = new URL(asset.url, manifestUrl);
  const permitted = url.protocol === 'https:' || (url.protocol === 'http:' && LOCAL.has(url.hostname));
  if (!permitted || url.username !== '' || url.password !== '' || !FILE_NAME.test(asset.name)) {
    throw new Error('清单中的下载地址格式不对。');
  }
  return { ...asset, url: url.href };
}

/** 桌面客户端（11-08 起的主下载）：Mac 给 dmg（没有 dmg 才给 zip），Windows 给安装程序；没有的系统是 null。 */
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

/** 「2026.1108」：发布版本号的前两段（年.月日），下载页上看得懂哪天的。 */
export function shortVersion(version: string): string {
  return version.split('.').slice(0, 2).join('.');
}

/** 装在服务器上：只要 manifest.json 里的 Linux 安装脚本，命令照 linuxInstallCommand。 */
export function parseLinuxCommand(text: string, manifestUrl: string): string {
  const asset = parseReleaseManifest(text).assets.linuxInstaller;
  if (asset === undefined) throw new Error('Linux 安装脚本还没有。');
  const url = checkedAsset(asset, manifestUrl).url;
  return `curl -fsSL '${url.replace(/'/g, "'\\''")}' | sudo sh`;
}
