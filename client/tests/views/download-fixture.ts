import type { ReleaseManifest } from '../../../agent/shared/release-manifest.ts';

export function releaseFixture(): ReleaseManifest {
  const asset = (name: string) => ({ name, url: `2026.1106.120000/${name}`, sha256: 'a'.repeat(64), size: 8192 });
  return { schema: 1, version: '2026.1106.120000', commit: 'b'.repeat(40),
    publishedAt: '2026-11-06T12:00:00.000Z', nodeVersion: '24.22.1', assets: {
      server: asset('plasticine-server.tar.gz'), linuxInstaller: asset('install.sh'),
      mac: asset('Plasticine-mac-arm64.zip'), windows: asset('Plasticine-windows-x64.exe'),
    } };
}
