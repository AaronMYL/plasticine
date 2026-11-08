// 手动操作的去重只在内存里。换代后拒绝旧请求，避免重启或缓存淘汰后重放一次点按。
import { createHash, randomUUID } from 'node:crypto';
import type { BrowserViewDto } from '../../shared/api/browser.ts';
import { CloudToolError } from './errors.ts';

// 高频鼠标事件也不能无限留内存；满一代后发新 instanceId，旧代请求只能重新看画面后生成新动作。
const MAX_REQUESTS = 2_048;
export class BrowserRequests {
  #id = randomUUID();
  readonly #pending = new Map<string, { digest: string; result: Promise<BrowserViewDto> }>();

  get id(): string { return this.#id; }

  run(owner: string, requestId: string, instanceId: string | undefined, input: unknown,
    work: () => Promise<BrowserViewDto>): Promise<BrowserViewDto> {
    if (instanceId !== this.#id) {
      throw new CloudToolError('invalid_input', '浏览器操作会话已更新，请刷新画面后重新操作。');
    }
    const key = `${owner}:${requestId}`;
    const digest = createHash('sha256').update(JSON.stringify(input)).digest('hex');
    const previous = this.#pending.get(key);
    if (previous !== undefined) {
      if (previous.digest !== digest) {
        throw new CloudToolError('invalid_input', '这个操作标识已经用过，请重新操作。');
      }
      return previous.result;
    }
    if (this.#pending.size >= MAX_REQUESTS) {
      this.#id = randomUUID();
      this.#pending.clear();
    }
    const result = work().catch((error: unknown) => {
      if (error instanceof CloudToolError) {
        throw error;
      }
      throw new CloudToolError('unknown', '操作回执没有收到，请看画面核对后再操作。');
    });
    this.#pending.set(key, { digest, result });
    return result;
  }
}
