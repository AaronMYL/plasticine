// 附件草稿字节留 IndexedDB，操作标识和小元数据留 sessionStorage；不把 10 MiB 图片塞进操作日志。
export class AttachmentBytes {
  private readonly cache = new Map<string, string>();
  private readonly factory: IDBFactory | null;
  constructor(factory: IDBFactory | null = typeof indexedDB === 'undefined' ? null : indexedDB) {
    this.factory = factory;
  }

  async put(id: string, content: string): Promise<void> {
    this.cache.set(id, content);
    await this.access('readwrite', (store) => store.put(content, id));
  }

  async get(id: string): Promise<string | null> {
    const cached = this.cache.get(id);
    if (cached !== undefined) {
      return cached;
    }
    const result = await this.access('readonly', (store) => store.get(id));
    return typeof result === 'string' ? result : null;
  }

  async remove(id: string): Promise<void> {
    this.cache.delete(id);
    await this.access('readwrite', (store) => store.delete(id));
  }

  private async access(mode: IDBTransactionMode, action: (store: IDBObjectStore) => IDBRequest): Promise<unknown> {
    if (this.factory === null) {
      return undefined;
    }
    const factory = this.factory;
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = factory.open('plasticine-attachment-drafts', 1);
      request.onupgradeneeded = () => request.result.createObjectStore('bytes');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(new Error('附件草稿暂存不可用，请保留页面后重试。'));
      request.onblocked = () => reject(new Error('附件暂存正在等待其他页面关闭。'));
    });
    try {
      return await new Promise<unknown>((resolve, reject) => {
        const transaction = db.transaction('bytes', mode);
        const request = action(transaction.objectStore('bytes'));
        transaction.oncomplete = () => resolve(request.result);
        transaction.onabort = () => reject(new Error('附件草稿未存好，可能是存储空间不足。'));
        transaction.onerror = () => reject(new Error('附件草稿未存好，可能是存储空间不足。'));
      });
    } finally {
      db.close();
    }
  }
}

export function readFileBytes(file: File): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () =>
      typeof reader.result === 'string' || reader.result === null
        ? reject(new Error('没有读到文件字节。'))
        : resolve(reader.result);
    reader.onerror = () => reject(new Error('文件没有读好，请重新选择。'));
    reader.readAsArrayBuffer(file);
  });
}

export function base64Of(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  const chunks: string[] = [];
  for (let i = 0; i < bytes.length; i += 8192) {
    chunks.push(String.fromCharCode(...bytes.subarray(i, i + 8192)));
  }
  return btoa(chunks.join(''));
}
