// 消息的列表（11-07 设计稿 Messages：电脑上是第二栏，手机上是消息页）：标题「消息」+ 找、加人两个图标；下面一条撑满的
// 分段控件 全部 · 人 · 群 · 邮件；再下面是列表——有新请求时一行（陶土橙点 +「新请求」+ 数），然后是这一段的人 / 群 /
// 邮件：头像（人圆、群和邮件圆角方块）、名字、时间（等宽）、最后一句（对方或我的 AI 说的前面一个 ✦）、行尾未读数或
// 等你点。按最近排，新的一句来了 FlipList 平移过去。Plasticine 不在这里（它有自己的栏目）。

import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { ContactRow } from '../../api/shared.ts';
import { useLive, useTimeZone } from '../../live.tsx';
import { useStore } from '../../state/use-store.ts';
import { FlipList } from '../../shell/flip-list.tsx';
import { plainPreview } from '../../primitives/message/plain-preview.ts';
import { AiMark } from '../../shell/glyph.tsx';
import { IconButton } from '../../shell/icon-button.tsx';
import { ColumnCollapseButton } from '../../shell/columns/column-toggle.tsx';
import { Icon } from '../../shell/icons.tsx';
import { LoadNote } from '../m5b/load-note.tsx';
import { ContactAvatar } from '../contacts/contact-avatar.tsx';
import { listTime } from '../contacts/contact-time.ts';
import {
  FILTER_LABELS,
  MESSAGE_FILTERS,
  rowsFor,
  showsRequests,
  startsOtherGroup,
  type MessageFilter,
} from './message-filter.ts';

function matches(row: ContactRow, query: string): boolean {
  const needle = query.trim().toLowerCase();
  const texts = [row.name, row.handle ?? '', row.address ?? '', row.last?.text ?? ''];
  return needle === '' || texts.some((text) => text.toLowerCase().includes(needle));
}

function rowLabel(row: ContactRow): string {
  const parts = [row.name];
  if (row.waiting) {
    parts.push('等你');
  }
  if (row.unread > 0) {
    parts.push(`${row.unread} 条没读`);
  }
  return parts.join('，');
}

function Row({ row, current, phone, now, groupStart, onOpen }: { row: ContactRow; current: boolean; phone: boolean;
  now: Date; groupStart: boolean; onOpen: () => void }): ReactNode {
  const timeZone = useTimeZone();
  const previewId = `contact-preview-${row.id}`;
  const byAi = row.last?.author === 'my_ai' || row.last?.author === 'their_ai';
  return (
    <li className="contact-row-item" data-group-start={groupStart ? 'true' : undefined}>
      <button type="button" className="contact-row" aria-current={current ? 'true' : undefined}
        aria-label={rowLabel(row)} aria-describedby={row.last === null ? undefined : previewId} onClick={onOpen}>
        <ContactAvatar row={row} size={phone ? 44 : 36} />
        <span className="contact-row-main">
          <span className="contact-row-top">
            <span className="contact-row-name">{row.name}</span>
            {row.last === null ? null
              : <span className="mono contact-row-time">{listTime(row.last.at, now, timeZone)}</span>}
          </span>
          <span className="contact-row-bottom">
            {row.last === null ? <span className="contact-row-preview" /> : (
              <span id={previewId} className="contact-row-preview">
                {byAi ? <AiMark label={row.last.author === 'my_ai' ? '你的 Plasticine' : `${row.name}的 Plasticine`} />
                  : null}
                {row.last.sender === undefined ? null : `${row.last.sender}：`}
                {plainPreview(row.last.text)}
              </span>
            )}
            {row.unread > 0 ? <span className="contact-unread mono" aria-hidden="true">{row.unread}</span> : null}
            {row.waiting ? <span className="dot dot-accent" aria-hidden="true" /> : null}
          </span>
        </span>
      </button>
    </li>
  );
}

function FilterControl({ filter, onFilter }: { filter: MessageFilter; onFilter: (filter: MessageFilter) => void })
  : ReactNode {
  return (
    <div className="segmented messages-filter" role="group" aria-label="筛选">
      {MESSAGE_FILTERS.map((item) => (
        <button key={item} type="button" className="segmented-item" aria-pressed={filter === item}
          onClick={() => onFilter(item)}>
          {FILTER_LABELS[item]}
        </button>
      ))}
    </div>
  );
}

export type AddChoice = 'add' | 'new-group' | 'invite';

const ADD_CHOICES: ReadonlyArray<{ id: AddChoice; label: string; icon: 'person' | 'thread' | 'mail' }> = [
  { id: 'add', label: '加好友', icon: 'person' },
  { id: 'new-group', label: '新建群聊', icon: 'thread' },
  { id: 'invite', label: '邀请朋友加入网络', icon: 'mail' },
];

/** 「+」点开的小菜单：加好友 · 新建群聊 · 邀请朋友加入网络。点外面或 Esc 收起。 */
function AddMenu({ phone, onChoose }: { phone: boolean; onChoose: (choice: AddChoice) => void }): ReactNode {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) {
      return;
    }
    const close = (event: PointerEvent): void => {
      if (event.target instanceof Node && box.current?.contains(event.target) !== true) {
        setOpen(false);
      }
    };
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, [open]);
  return (
    <div ref={box} className="add-menu-anchor" onKeyDown={(event) => {
      if (event.key === 'Escape') {
        setOpen(false);
      }
    }}>
      <IconButton icon="plus" size={phone ? 20 : 16} label="加人、建群、邀请" aria-expanded={open}
        aria-pressed={open} onClick={() => setOpen((value) => !value)} />
      {open ? (
        <div className="add-menu" role="menu" aria-label="加人、建群、邀请">
          {ADD_CHOICES.map((choice) => (
            <button key={choice.id} type="button" role="menuitem" className="add-menu-item" onClick={() => {
              setOpen(false);
              onChoose(choice.id);
            }}>
              <Icon name={choice.icon} size={16} />
              {choice.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export interface MessagesListProps {
  filter: MessageFilter;
  onFilter: (filter: MessageFilter) => void;
  /** 现在打开的那一条联系人 id。 */
  selectedId: string | null;
  requestsOpen: boolean;
  phone: boolean;
  now: Date;
  onOpen: (id: string) => void;
  onRequests: () => void;
  onAdd: (choice: AddChoice) => void;
}

export function MessagesList(props: MessagesListProps): ReactNode {
  const { contacts } = useLive();
  const list = useStore(contacts.list.data);
  const [query, setQuery] = useState<string | null>(null);
  const all = list.value?.contacts ?? [];
  const rows = rowsFor(all, props.filter).filter((row) => matches(row, query ?? ''));
  const requests = showsRequests(props.filter) && query === null ? list.value?.requests ?? 0 : 0;
  const iconSize = props.phone ? 20 : 16;
  return (
    <div className="contact-list messages-list" data-phone={props.phone}>
      <div className="contact-list-head">
        {props.phone ? <h1 className="contact-list-title">消息</h1> : <h2 className="contact-list-title">消息</h2>}
        <IconButton icon="search" size={iconSize} label="搜消息" aria-pressed={query !== null}
          onClick={() => setQuery((value) => (value === null ? '' : null))} />
        <AddMenu phone={props.phone} onChoose={props.onAdd} />
        {props.phone ? null : <ColumnCollapseButton />}
      </div>
      <FilterControl filter={props.filter} onFilter={props.onFilter} />
      {query === null ? null : (
        <input className="field-input contact-list-search" type="search" aria-label="查找" value={query}
          autoFocus placeholder="名字、@handle、地址" onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              setQuery(null);
            }
          }} />
      )}
      <LoadNote resource={list} what="联系人" onRetry={() => void contacts.list.reload()} />
      {requests > 0 ? (
        <button type="button" className="contact-row contact-requests-row" aria-current={props.requestsOpen
          ? 'true' : undefined} aria-label={`新请求 ${requests}`} onClick={props.onRequests}>
          <span className="contact-requests-dot"><span className="dot dot-accent" aria-hidden="true" /></span>
          <span className="contact-row-name">新请求</span>
          <span className="mono contact-requests-count">{requests}</span>
          {props.phone ? <Icon name="chevron-right" size={16} /> : null}
        </button>
      ) : null}
      {list.value !== null && rows.length === 0 && requests === 0
        ? <p className="contact-list-empty">{query === null ? '这一栏是空的' : '没找到'}</p> : null}
      <FlipList className="contact-rows" keys={rows.map((row) => row.id)} label={FILTER_LABELS[props.filter]}>
        {rows.map((row, index) => (
          <Row key={row.id} row={row} current={row.id === props.selectedId} phone={props.phone} now={props.now}
            groupStart={startsOtherGroup(rows, index)} onOpen={() => props.onOpen(row.id)} />
        ))}
      </FlipList>
    </div>
  );
}
