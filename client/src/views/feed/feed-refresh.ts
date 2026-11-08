import type { FeedApi } from '../../api/client.ts';
import type { FeedRefresh, RefreshFeedRequest } from '../../api/shared.ts';
import { errorText, uncertainError } from '../../api/errors.ts';
import { Store } from '../../state/store.ts';

const REFRESH_POLL_MS = 600;
export interface FeedRefreshState { busy: boolean; run: FeedRefresh | null; error: string | null }

function wait(signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const abort = (): void => { clearTimeout(timer); reject(signal.reason); };
    const timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve(); }, REFRESH_POLL_MS);
    signal.addEventListener('abort', abort, { once: true });
  });
}

export class FeedRefreshTracker {
  readonly state = new Store<FeedRefreshState>({ busy: false, run: null, error: null });
  private readonly api: FeedApi;
  private readonly reload: () => Promise<void>;
  private pending: Promise<void> | null = null;
  private controller: AbortController | null = null;

  constructor(api: FeedApi, reload: () => Promise<void>) { this.api = api; this.reload = reload; }

  collect(body: RefreshFeedRequest): Promise<void> {
    if (this.pending !== null) { return this.pending; }
    this.controller = new AbortController();
    this.pending = this.run(body, this.controller.signal).finally(() => {
      this.pending = null;
      this.controller = null;
    });
    return this.pending;
  }
  stop(): void { this.controller?.abort(new Error('页面连接已关闭，服务端已接收的刷新仍继续。')); }

  private async run(body: RefreshFeedRequest, signal: AbortSignal): Promise<void> {
    this.state.set({ busy: true, run: null, error: null });
    let accepted = false;
    try {
      let run = await this.api.refresh(body);
      accepted = true;
      while (run.status === 'queued' || run.status === 'running') {
        this.state.set({ busy: true, run, error: null });
        signal.throwIfAborted();
        await wait(signal);
        run = await this.api.refreshStatus(body.requestId, signal);
      }
      this.state.set({ busy: false, run, error: run.error });
      await this.reload();
    } catch (cause) {
      this.state.set((state) => ({ ...state, busy: false, error: errorText(cause) }));
      throw accepted ? uncertainError('刷新已经接收，进度尚未读到', errorText(cause)) : cause;
    }
  }
}
