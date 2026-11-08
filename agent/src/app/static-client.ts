// 安装包里的实例自己发客户端构建（docs/install-packages.md）：用 Caddy 挡在前面的部署里这件事是 Caddy 做的（agent/deploy/Caddyfile），
// Linux / Mac / Windows 的自托管实例没有 Caddy，由服务进程按同样的规则发 client/dist：/v2/* 交给接口，
// /assets/* 长缓存，入口页 no-cache，其余路径回 index.html。只在设了 PLASTICINE_CLIENT_DIR 时挂上。

import { readFile, stat } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { extname, isAbsolute, relative, resolve, sep } from 'node:path';

type Handler = (req: IncomingMessage, res: ServerResponse) => void;

// 和 Caddyfile 的 @assets 一样：带哈希的构建产物一年；入口页每次都问。
const IMMUTABLE = 'public, max-age=31536000, immutable';
const ENTRY = 'index.html';

const TYPES: Readonly<Record<string, string>> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.map': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.txt': 'text/plain; charset=utf-8',
  '.wasm': 'application/wasm',
};

function isApi(pathname: string): boolean {
  return pathname === '/v2' || pathname.startsWith('/v2/');
}

/** 解码后的路径落在构建目录里才给文件名；`..`、NUL、坏编码都回 null。 */
function insideRoot(root: string, pathname: string): string | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return null;
  }
  if (decoded.includes('\0')) {
    return null;
  }
  const target = resolve(root, `.${decoded}`);
  const offset = relative(root, target);
  if (offset.startsWith('..') || isAbsolute(offset) || offset.split(sep).includes('..')) {
    return null;
  }
  return target;
}

async function regularFile(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT' || (error as NodeJS.ErrnoException).code === 'ENOTDIR') {
      return false;
    }
    throw error;
  }
}

function plain(res: ServerResponse, status: number, text: string, headers: Record<string, string> = {}): void {
  res.writeHead(status, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store', ...headers });
  res.end(text);
}

async function sendFile(req: IncomingMessage, res: ServerResponse, path: string, cache: string): Promise<void> {
  const data = await readFile(path);
  res.writeHead(200, {
    'content-type': TYPES[extname(path).toLowerCase()] ?? 'application/octet-stream',
    'content-length': data.length,
    'cache-control': cache,
    'x-content-type-options': 'nosniff',
  });
  res.end(req.method === 'HEAD' ? undefined : data);
}

async function serveClient(root: string, req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    plain(res, 405, '只接受 GET / HEAD。', { allow: 'GET, HEAD' });
    return;
  }
  const pathname = new URL(req.url ?? '/', 'http://localhost').pathname;
  const target = insideRoot(root, pathname);
  if (target === null) {
    plain(res, 400, '路径无效。');
    return;
  }
  const isAsset = pathname.startsWith('/assets/');
  if (pathname !== '/' && await regularFile(target)) {
    await sendFile(req, res, target, isAsset ? IMMUTABLE : 'no-cache');
    return;
  }
  // 缺了的脚本、样式不拿入口页冒充（浏览器会把 HTML 当脚本解析报错，看不出是缺文件）。
  if (isAsset) {
    plain(res, 404, '没有这个文件。');
    return;
  }
  await sendFile(req, res, resolve(root, ENTRY), 'no-cache');
}

/** 在接口处理器前面挂客户端构建：/v2/* 原样交给 `api`，其余路径按构建目录发文件。 */
export function withClientFiles(directory: string, api: Handler): Handler {
  const root = resolve(directory);
  return (req, res) => {
    const pathname = new URL(req.url ?? '/', 'http://localhost').pathname;
    if (isApi(pathname)) {
      api(req, res);
      return;
    }
    serveClient(root, req, res).catch((error: unknown) => {
      const reason = error instanceof Error ? error.message : String(error);
      if (res.headersSent) {
        res.destroy();
        return;
      }
      plain(res, 500, `读取客户端文件失败：${reason}`);
    });
  };
}
