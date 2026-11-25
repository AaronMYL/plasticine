import { readFileSync, writeFileSync } from 'node:fs';
import { basename } from 'node:path';
import { parseArgs } from 'node:util';
import { PACKAGE_NODE_VERSION, parseReleaseManifest, parseServerManifest, sha256Hex, type ReleaseAsset,
  type ReleaseManifest } from './release-manifest.ts';

export interface ReleaseFiles {
  server: string;
  installer: string;
}

function asset(file: string, baseUrl: string): ReleaseAsset {
  const bytes = readFileSync(file);
  const name = basename(file);
  return { name, url: `${baseUrl.replace(/\/$/, '')}/${encodeURIComponent(name)}`, sha256: sha256Hex(bytes),
    size: bytes.length };
}

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
    },
  };
  return parseReleaseManifest(JSON.stringify(manifest));
}

if (import.meta.main) {
  const { values } = parseArgs({ options: {
    'base-url': { type: 'string' },
    server: { type: 'string' },
    'server-manifest': { type: 'string' },
    installer: { type: 'string' },
    out: { type: 'string', default: 'manifest.json' },
  } });
  const baseUrl = values['base-url'];
  if (baseUrl === undefined || values.server === undefined || values.installer === undefined
    || values['server-manifest'] === undefined) {
    console.error('要给 --base-url、--server、--server-manifest、--installer。');
    process.exitCode = 2;
  } else {
    const manifest = releaseManifest({ server: values.server, installer: values.installer },
      readFileSync(values['server-manifest'], 'utf8'), baseUrl, new Date());
    writeFileSync(values.out, `${JSON.stringify(manifest, null, 2)}\n`);
    console.log(JSON.stringify({ version: manifest.version, assets: Object.keys(manifest.assets) }));
  }
}
