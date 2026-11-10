import type { ResponseLike } from './transport.ts';

export type UploadLike = (url: string, init: RequestInit, progress: (fraction: number) => void) =>
  Promise<ResponseLike>;

/** fetch 不报告上传进度；仍走 Transport 的相同请求头、错误分类和取消信号。 */
export const xhrUpload: UploadLike = (url, init, progress) => new Promise((resolve, reject) => {
  const request = new XMLHttpRequest();
  request.open(init.method ?? 'POST', url, true);
  for (const [key, value] of new Headers(init.headers).entries()) request.setRequestHeader(key, value);
  const signal = init.signal;
  const abort = (): void => request.abort();
  const cleanup = (): void => {
    signal?.removeEventListener('abort', abort);
    request.upload.onprogress = null;
  };
  request.upload.onprogress = (event) => {
    if (event.lengthComputable && event.total > 0) progress(event.loaded / event.total);
  };
  request.onload = () => {
    cleanup();
    resolve({ status: request.status, text: async () => request.responseText });
  };
  request.onerror = () => { cleanup(); reject(new TypeError('上传连接中断')); };
  request.onabort = () => { cleanup(); reject(signal?.reason ?? new DOMException('已取消上传', 'AbortError')); };
  if (signal?.aborted) {
    cleanup();
    reject(signal.reason);
    return;
  }
  signal?.addEventListener('abort', abort, { once: true });
  request.send(typeof init.body === 'string' ? init.body : null);
});
