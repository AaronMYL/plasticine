// 设置 · 通知记录（第 106、111 条）：铃和站内信页去掉了，Plasticine 自己发的通知（站内信里 source = plasticine 的那些）
// 在这里按时间列出来。没读的标题前一个点；点开一条看全文，同时标成读过（经 action-ops，回执丢了能核实）。

import { useEffect, useState, type ReactNode } from 'react';
import type { InboxRowView } from '../../api/shared.ts';
import { useLive, useTimeZone } from '../../live.tsx';
import { useStore } from '../../state/use-store.ts';
import { LoadNote, shortTime } from '../m5b/load-note.tsx';
import { plainPreview } from '../../primitives/message/plain-preview.ts';

function Notice({ row, open, onToggle }: { row: InboxRowView; open: boolean; onToggle: () => void }): ReactNode {
  const { m5b } = useLive();
  const timeZone = useTimeZone();
  const message = useStore(m5b.inbox.message.data);
  const body = open && message.value?.id === row.id ? message.value.body : null;
  return (
    <li className="notice-row" data-read={row.read}>
      <button type="button" className="notice-head" aria-expanded={open} onClick={onToggle}>
        {row.read ? null : <span className="dot notice-unread" role="img" aria-label="没读" />}
        <span className="notice-title">{plainPreview(row.title)}</span>
        <span className="text-meta notice-time">{shortTime(row.receivedAt, timeZone)}</span>
      </button>
      {open ? (
        <div className="notice-body">
          {body === null ? <LoadNote resource={message} what="这条通知"
            onRetry={() => m5b.inbox.openMessage(row.id)} /> : <p>{body}</p>}
        </div>
      ) : null}
    </li>
  );
}

export function NoticesSection(): ReactNode {
  const { m5b, m5bActions } = useLive();
  const list = useStore(m5b.inbox.list.data);
  const [openId, setOpenId] = useState<string | null>(null);
  useEffect(() => {
    m5b.inbox.showBox('plasticine');
  }, [m5b.inbox]);
  const rows = list.value?.messages.filter((row) => row.source === 'plasticine') ?? [];
  const toggle = (row: InboxRowView): void => {
    if (openId === row.id) {
      setOpenId(null);
      return;
    }
    setOpenId(row.id);
    m5b.inbox.openMessage(row.id);
    if (!row.read) {
      void m5bActions.setInboxFlag(row, 'read', true);
    }
  };
  return (
    <section className="block" aria-labelledby="settings-notices">
      <header className="block-head">
        <h3 id="settings-notices" className="block-title">通知记录</h3>
      </header>
      <LoadNote resource={list} what="通知记录" onRetry={() => void m5b.inbox.list.reload()} />
      {list.value !== null && rows.length === 0 ? <p className="notice-empty">还没有通知</p> : null}
      {rows.length === 0 ? null : (
        <ul className="notice-list" aria-label="通知">
          {rows.map((row) => <Notice key={row.id} row={row} open={openId === row.id} onToggle={() => toggle(row)} />)}
        </ul>
      )}
    </section>
  );
}
