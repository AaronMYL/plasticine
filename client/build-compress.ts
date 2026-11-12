// 打包时把文字类的界面文件压好（2026-11-12《首次使用解耦》）：每个文件旁边写一份 .br（最高档）和 .gz，本体按请求头
// 挑一份发（agent/src/app/static-client.ts），运行时不用再压。中继只转加密字节、压不了，所以只能在这里压。
// 已经是压缩格式的（woff2、图片）不压；压完省不到一成的不留。不写进 client-manifest.json：清单只记原文件。

import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import { brotliCompressSync, constants, gzipSync } from 'node:zlib';
import type { Plugin } from 'vite';

const TEXT_TYPES = new Set(['.js', '.mjs', '.css', '.html', '.svg', '.json', '.webmanifest', '.txt', '.wasm',
  '.ttf']);
const MIN_BYTES = 1024;
/** 压完至少省这么多才留。 */
const MIN_SAVING = 0.1;

function files(directory: string): string[] {
  return readdirSync(directory).flatMap((name) => {
    const path = join(directory, name);
    return statSync(path).isDirectory() ? files(path) : [path];
  });
}

/** 把目录里该压的文件压好，回写了哪些（相对路径）。 */
export function precompressDirectory(directory: string): string[] {
  const written: string[] = [];
  for (const path of files(directory)) {
    if (!TEXT_TYPES.has(extname(path).toLowerCase())) continue;
    const raw = readFileSync(path);
    if (raw.length < MIN_BYTES) continue;
    const variants: [string, Buffer][] = [
      ['.br', brotliCompressSync(raw, { params: { [constants.BROTLI_PARAM_QUALITY]: 11,
        [constants.BROTLI_PARAM_SIZE_HINT]: raw.length } })],
      ['.gz', gzipSync(raw, { level: 9 })],
    ];
    for (const [suffix, data] of variants) {
      if (data.length > raw.length * (1 - MIN_SAVING)) continue;
      writeFileSync(`${path}${suffix}`, data);
      written.push(`${path.slice(directory.length + 1)}${suffix}`);
    }
  }
  return written.sort();
}

export function precompress(): Plugin {
  let outDir = 'dist';
  return {
    name: 'plasticine-precompress',
    apply: 'build',
    configResolved(config) {
      outDir = resolve(config.root, config.build.outDir);
    },
    closeBundle() {
      precompressDirectory(outDir);
    },
  };
}
