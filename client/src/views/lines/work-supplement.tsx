// 同一件工作的补充保存在自己的草稿里；发送失败用原 requestId 重试，暂停时只入队。

import { useState, type ReactNode } from 'react';
import { LINE_MESSAGE_MAX_CHARS, type LineView } from '../../api/shared.ts';
import { useLive } from '../../live.tsx';
import { Icon } from '../../shell/icons.tsx';
import { useClientState } from '../../state/context.tsx';
import { useStore } from '../../state/use-store.ts';
import type { LineThreadData } from './line-thread-data.ts';

export function WorkSupplement({ line, thread }: { line: LineView; thread: LineThreadData }): ReactNode {
  const live = useLive();
  const { inlineDrafts } = useClientState();
  const key = `work:${line.id}:supplement`;
  const text = useStore(inlineDrafts.store).get(key) ?? '';
  const [busy, setBusy] = useState(false);
  const failed = thread.pending.filter((item) => item.status === 'failed');
  const send = (): void => {
    if (busy || text.trim() === '' || failed.length > 0) return;
    const sent = text.trim();
    setBusy(true);
    void live.lines.send(line.id, sent).then((okay) => {
      if (okay) inlineDrafts.clearIfSent(key, sent);
      setBusy(false);
    });
  };
  const retry = (requestId: string, sent: string): void => {
    setBusy(true);
    void live.lines.resend(line.id, requestId).then((okay) => {
      if (okay) inlineDrafts.clearIfSent(key, sent);
      setBusy(false);
    });
  };
  return <footer className="work-footer">
    {line.queued > 0 ? <div className="work-queue" role="status"><Icon name="clock" size={13} />
      {line.status === 'paused' ? `${line.queued} 条修改待处理，继续后执行` : `${line.queued} 条补充已排队`}
    </div> : null}
    {failed.map((item) => <div className="work-send-error" role="alert" key={item.requestId}>
      <span>{item.error ?? '补充没能送到'}</span>
      <button type="button" className="text-button" disabled={busy}
        onClick={() => retry(item.requestId, item.text)}>重试发送</button>
      <button type="button" className="text-button" disabled={busy}
        onClick={() => live.lines.discard(line.id, item.requestId)}>编辑后重发</button>
    </div>)}
    <form className="work-compose" onSubmit={(event) => { event.preventDefault(); send(); }}>
      <textarea aria-label="补充这件事" placeholder="补充这件事…" rows={2} value={text}
        maxLength={LINE_MESSAGE_MAX_CHARS} onChange={(event) => inlineDrafts.set(key, event.target.value)} />
      <button type="submit" className="work-send" aria-label="发送补充"
        disabled={busy || text.trim() === '' || failed.length > 0}><Icon name="send" size={17} /></button>
    </form>
  </footer>;
}
