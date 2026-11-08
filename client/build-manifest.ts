import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type { Plugin } from 'vite';
import type { ClientManifest } from '../agent/shared/api/client-updates.ts';
/** 每次构建一份不可变清单；构建本身不宣称已经上线。 */
export function clientManifest(buildId: string, builtAt: string): Plugin {
  return {
    name: 'plasticine-client-manifest',
    apply: 'build',
    enforce: 'post',
    generateBundle: {
      order: 'post',
      handler(_options, bundle) {
        const assets = Object.entries(bundle)
          .map(([path, item]) => {
            const bytes = Buffer.from(item.type === 'chunk' ? item.code : item.source);
            return { path, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') };
          })
          .sort((a, b) => a.path.localeCompare(b.path));
        const worker = readFileSync(new URL('./public/sw.js', import.meta.url));
        assets.push({ path: 'sw.js', bytes: worker.length, sha256: createHash('sha256').update(worker).digest('hex') });
        const manifest: ClientManifest = {
          buildId,
          builtAt,
          protocol: { min: 2, max: 2 },
          summary: '网页版本更新',
          assets,
        };
        this.emitFile({ type: 'asset', fileName: 'client-manifest.json', source: JSON.stringify(manifest) });
      },
    },
  };
}
