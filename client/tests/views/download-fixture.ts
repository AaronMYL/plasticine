import type { DesktopReleaseManifest } from '../../../agent/shared/desktop-release.ts';
import type { ReleaseManifest } from '../../../agent/shared/release-manifest.ts';

const asset = (name: string, version: string) => ({ name, url: `${version}/${name}`, sha256: 'a'.repeat(64),
  size: 8192 });

/** 桌面客户端的发布清单（desktop.json）：Mac 的 zip 和 dmg、Windows 安装程序。 */
export function desktopFixture(): DesktopReleaseManifest {
  const version = '2026.1108.120000';
  return { schema: 1, version, commit: 'c'.repeat(40), publishedAt: '2026-11-08T12:00:00.000Z', assets: {
    mac: asset('Plasticine-mac.zip', version), macDisk: asset('Plasticine.dmg', version),
    windows: asset('Plasticine-Setup.exe', version),
  } };
}

/** 服务包的发布清单（manifest.json）：下载页只拿 Linux 安装脚本。 */
export function releaseFixture(): ReleaseManifest {
  const version = '2026.1106.120000';
  return { schema: 1, version, commit: 'b'.repeat(40),
    publishedAt: '2026-11-06T12:00:00.000Z', nodeVersion: '24.22.1', assets: {
      server: asset('plasticine-server.tar.gz', version), linuxInstaller: asset('install.sh', version),
      mac: asset('Plasticine-mac-arm64.zip', version), windows: asset('Plasticine-windows-x64.exe', version),
    } };
}
