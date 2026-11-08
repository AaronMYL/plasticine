// 还没有工作时给一个直接开始的入口；发出的那句在已有对话里继续，不留一个看不到答案的首页输入框。

import { useState, type ReactNode } from 'react';
import { LINE_MESSAGE_MAX_CHARS } from '../../api/shared.ts';
import { useLive } from '../../live.tsx';
import { Icon } from '../../shell/icons.tsx';
import { useClientState } from '../../state/context.tsx';
import { useStore } from '../../state/use-store.ts';

export function HomeStart({ phone }: { phone: boolean }): ReactNode {
  const live = useLive();
  const { inlineDrafts, shellPrefs } = useClientState();
  const list = useStore(live.lines.list);
  const asks = useStore(live.asks.store);
  const key = 'home:start';
  const text = useStore(inlineDrafts.store).get(key) ?? '';
  const [busy, setBusy] = useState(false);
  const main = list.lines.find((line) => line.kind === 'main');
  if (!list.loaded || list.error !== null || !asks.loaded || asks.error !== null || asks.open.length > 0
    || list.lines.some((line) => line.kind === 'background') || main?.lastAnswer != null
    || main !== undefined && main.status !== 'idle') return null;
  const start = (): void => {
    if (busy || text.trim() === '') return;
    const sent = text.trim();
    setBusy(true);
    if (phone) shellPrefs.setPhoneChatOpen(true);
    else shellPrefs.setChatOpen(true);
    void live.lines.send('main', sent).then((okay) => {
      if (okay) inlineDrafts.clearIfSent(key, sent);
      setBusy(false);
    });
  };
  return <section className="home-start" aria-label="开始一件事">
    <h2>有什么想一起做的？</h2>
    <form onSubmit={(event) => { event.preventDefault(); start(); }}>
      <textarea aria-label="想一起做什么" placeholder="说说你想做的事…" value={text} rows={2}
        maxLength={LINE_MESSAGE_MAX_CHARS} onChange={(event) => inlineDrafts.set(key, event.target.value)} />
      <button type="submit" className="primary-button" aria-label="开始聊" disabled={busy || text.trim() === ''}>
        <Icon name="send" size={17} /></button>
    </form>
  </section>;
}
