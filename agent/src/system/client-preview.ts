import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import type { ClientManifest } from '../../shared/api/client-updates.ts';
import { StateError } from '../state/index.ts';
import { readClientManifest } from './client-manifest.ts';

/** 已登记构建的实际资源，预览不修改 current，也不登记发布回执。 */
export function readClientPreview(manifestPath: string | null, manifest: ClientManifest, file: string) {
  if (manifestPath === null) throw new StateError('not_found', '这个环境没有客户端构建目录。');
  const root = dirname(dirname(manifestPath));
  const candidates = [join(root, manifest.buildId), join(root, manifest.buildId.slice(0, 7))];
  const directory = candidates.find((directory) => {
    const path = join(directory, basename(manifestPath));
    return existsSync(path) && readClientManifest(path).buildId === manifest.buildId;
  });
  if (directory === undefined) throw new StateError('not_found', '候选尚未构建到服务器，预览资源还不可用。');
  const asset = manifest.assets.find((item) => item.path === file);
  if (asset === undefined) throw new StateError('not_found', '这份构建没有该预览资源。');
  const data = readFileSync(join(directory, asset.path));
  if (data.length !== asset.bytes || createHash('sha256').update(data).digest('hex') !== asset.sha256) {
    throw new StateError('invalid_input', '预览资源与该候选的清单不一致。');
  }
  if (file === 'index.html') {
    const prefix = `/v2/client-preview/${encodeURIComponent(manifest.buildId)}`;
    return { data: Buffer.from(data.toString('utf8').replaceAll('"/assets/', `"${prefix}/assets/`)),
      type: 'text/html; charset=utf-8' };
  }
  const extension = file.split('.').at(-1);
  const types: Record<string, string> = { js: 'text/javascript', css: 'text/css', svg: 'image/svg+xml',
    png: 'image/png', woff2: 'font/woff2', json: 'application/json' };
  return { data, type: types[extension ?? ''] ?? 'application/octet-stream' };
}
