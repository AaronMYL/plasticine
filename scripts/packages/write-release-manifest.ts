// 给这一版的几个包算 SHA-256 和大小，写发布点上的 manifest.json（发布时由 publish-release.ts 调）。资源地址写成这一版
// 自己的目录（https://cyberhunter.top/download/<版本>/），清单和包换版本的那一刻也不会对不上。
//   node scripts/packages/write-release-manifest.ts --base-url https://cyberhunter.top/download/<版本> \
//     --server <tar.gz> --installer <install.sh> [--mac <zip>] [--windows <exe>] --out manifest.json

import { readFileSync, writeFileSync } from 'node:fs';
import { basename } from 'node:path';
import { parseArgs } from 'node:util';
import { PACKAGE_NODE_VERSION, parseReleaseManifest, parseServerManifest, sha256Hex, type ReleaseAsset,
  type ReleaseManifest } from './release-manifest.ts';

export interface ReleaseFiles {
  server: string;
  installer: string;
  mac?: string;
  windows?: string;
}

function asset(file: string, baseUrl: string): ReleaseAsset {
  const bytes = readFileSync(file);
  const name = basename(file);
  return { name, url: `${baseUrl.replace(/\/$/, '')}/${encodeURIComponent(name)}`, sha256: sha256Hex(bytes),
    size: bytes.length };
}

/** 版本和提交取自服务包里的 manifest.json（服务包解开前读不到，所以由调用方给出那一份的内容）。 */
export function releaseManifest(files: ReleaseFiles, serverManifestText: string, baseUrl: string,
  publishedAt: Date): ReleaseManifest {
  const server = parseServerManifest(serverManifestText);
  const manifest: ReleaseManifest = {
    schema: 1,
    version: server.version,
    commit: server.commit,
    publishedAt: publishedAt.toISOString(),
    nodeVersion: PACKAGE_NODE_VERSION,
    assets: {
      server: asset(files.server, baseUrl),
      linuxInstaller: asset(files.installer, baseUrl),
      ...(files.mac === undefined ? {} : { mac: asset(files.mac, baseUrl) }),
      ...(files.windows === undefined ? {} : { windows: asset(files.windows, baseUrl) }),
    },
  };
  // 写出去之前按读的人同一份 schema 再核一遍。
  return parseReleaseManifest(JSON.stringify(manifest));
}

if (import.meta.main) {
  const { values } = parseArgs({ options: {
    'base-url': { type: 'string' },
    server: { type: 'string' },
    'server-manifest': { type: 'string' },
    installer: { type: 'string' },
    mac: { type: 'string' },
    windows: { type: 'string' },
    out: { type: 'string', default: 'manifest.json' },
  } });
  const baseUrl = values['base-url'];
  if (baseUrl === undefined || values.server === undefined || values.installer === undefined
    || values['server-manifest'] === undefined) {
    console.error('要给 --base-url、--server、--server-manifest、--installer。');
    process.exitCode = 2;
  } else {
    const manifest = releaseManifest({ server: values.server, installer: values.installer,
      ...(values.mac === undefined ? {} : { mac: values.mac }),
      ...(values.windows === undefined ? {} : { windows: values.windows }) },
    readFileSync(values['server-manifest'], 'utf8'), baseUrl, new Date());
    writeFileSync(values.out, `${JSON.stringify(manifest, null, 2)}\n`);
    console.log(JSON.stringify({ version: manifest.version, assets: Object.keys(manifest.assets) }));
  }
}
