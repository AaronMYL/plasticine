// 电脑替服务器取一个网址（第13批，11-14 Aaron：「优先服务器抓，抓不到再改由在线的电脑重试」；
// agent/shared/api/feed-computer-fetch.ts）：服务器连不上、被限流的博客和 Reddit，由在线的电脑用自己的网络取回正文交回，
// 解析、入库在服务端。只取 https 的公网地址（不替它碰本机、内网，跳转到内网的也不交回），跟着跳转，不带登录信息；
// 超过 2 MB 不要。

import { isIP } from 'node:net';
import type { ComputerFetchJob, ComputerFetchReport } from '../../../agent/shared/api/index.ts';
import { COMPUTER_FETCH_TEXT_MAX_CHARS } from '../../../agent/shared/api/index.ts';

const TIMEOUT_MS = 20_000;

export type Fetcher = (url: string, init?: RequestInit) => Promise<Response>;

/** 内网、本机的 IPv4 / IPv6 地址。 */
function privateAddress(host: string): boolean {
  const kind = isIP(host);
  if (kind === 4) {
    const [a = 0, b = 0] = host.split('.').map(Number);
    return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31)
      || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127);
  }
  if (kind === 6) {
    const lower = host.toLowerCase();
    return lower === '::1' || lower === '::' || lower.startsWith('fc') || lower.startsWith('fd')
      || lower.startsWith('fe80') || lower.startsWith('::ffff:');
  }
  return false;
}

/** 能不能替服务器取：https、不是本机、不是内网地址、不是 .local / .internal 这类局域网名字。 */
export function allowed(raw: string): boolean {
  let url: URL;
  try {
    url = new URL(raw);
  } catch (cause) {
    if (cause instanceof TypeError) { return false; }
    throw cause;
  }
  const host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  return url.protocol === 'https:' && url.username === '' && url.password === '' && host !== 'localhost'
    && !host.endsWith('.localhost') && !host.endsWith('.local') && !host.endsWith('.internal')
    && !privateAddress(host);
}

/** 读正文，超过上限就停。 */
async function readText(response: Response): Promise<string | null> {
  if (response.body === null) { return ''; }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let text = '';
  try {
    for (;;) {
      const next = await reader.read();
      if (next.done) { break; }
      text += decoder.decode(next.value, { stream: true });
      if (text.length > COMPUTER_FETCH_TEXT_MAX_CHARS) { return null; }
    }
    text += decoder.decode();
    return text.length > COMPUTER_FETCH_TEXT_MAX_CHARS ? null : text;
  } finally {
    await reader.cancel().catch(() => undefined);
  }
}

/** 取一件：回要交回去的 page / error（requestId、jobId 由调用方加）。 */
export async function fetchForServer(fetcher: Fetcher, job: ComputerFetchJob):
  Promise<Pick<ComputerFetchReport, 'page' | 'error'>> {
  if (!allowed(job.url)) { return { page: null, error: { code: 'refused' } }; }
  let response: Response;
  try {
    response = await fetcher(job.url, { redirect: 'follow', credentials: 'omit',
      signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return { page: null, error: { code: 'load_failed', detail: detail.slice(0, 300) } };
  }
  const finalUrl = response.url === '' ? job.url : response.url;
  if (!allowed(finalUrl)) {
    await response.body?.cancel().catch(() => undefined);
    return { page: null, error: { code: 'refused' } };
  }
  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined);
    return { page: null, error: { code: 'http_error', status: response.status } };
  }
  const text = await readText(response);
  return text === null ? { page: null, error: { code: 'too_large' } } : { page: { url: finalUrl, text }, error: null };
}
