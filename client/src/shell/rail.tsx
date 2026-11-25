import { UpdateButton } from './update-button.tsx';
import { useMainName } from '../views/mates/main-identity.tsx';
import { useState, type ReactNode } from 'react';
import type { ConnectionStatus } from '../api/types.ts';
import { accountInitial } from './account-name.ts';
import { Icon } from './icons.tsx';
import { PlasticineMark } from './plasticine-mark.tsx';
import { MainAvatar } from '../views/mates/mate-avatar.tsx';
import { MenuItem, Popover, anchorOf, type PopoverAnchor } from './popover.tsx';
import { RAIL_GROUPS, SECTIONS, type SectionId } from './sections.ts';

export type NewKind = 'mate' | 'note' | 'tab' | 'ask';

const CONNECTION_TEXT: Readonly<Record<ConnectionStatus, string>> = {
  open: '已连接',
  connecting: '连接中',
  closed: '未连接',
};

export interface RailProps {
  section: SectionId;
  waiting: number;
  connection: ConnectionStatus;
  accountName: string;
  accountAvatar: string | null;
  onSection: (section: SectionId) => void;
  onSearch: () => void;
  onNew: (kind: NewKind) => void;
  onSettings: () => void;
}

const NEW_ITEMS: ReadonlyArray<{ kind: NewKind; label: string; icon: 'conversation' | 'notes' | 'globe' | 'sparkle' }>
  = [
    { kind: 'ask', label: '跟 Plasticine 说', icon: 'sparkle' },
    { kind: 'mate', label: '添加队友', icon: 'conversation' },
    { kind: 'note', label: '新笔记', icon: 'notes' },
    { kind: 'tab', label: '新标签', icon: 'globe' },
  ];

export function Rail(props: RailProps): ReactNode {
  const [menu, setMenu] = useState<PopoverAnchor | null>(null);
  const offline = props.connection !== 'open';
  const mainName = useMainName();
  return (
    <nav className="rail" aria-label="栏目">
      <div className="rail-groups">
        {RAIL_GROUPS.map((group) => (
          <ul key={group[0]} className="rail-group">
            {group.map((id) => {
              const item = SECTIONS[id];
              const flagged = id === 'tasks' && props.waiting > 0;
              const label = flagged ? `${item.label} · 有等你的事` : item.label;
              return (
                <li key={id}>
                  <button type="button" className="rail-item" aria-label={label} data-tip={item.label}
                    data-tip-side="right" aria-current={props.section === id ? 'page' : undefined}
                    onClick={() => props.onSection(id)}>
                    {id === 'plasticine' ? <MainAvatar size={24} /> : item.icon === 'mark'
                      ? <PlasticineMark size={20} /> : <Icon name={item.icon} size={20} />}
                    {flagged ? <span className="rail-dot" aria-hidden="true" /> : null}
                  </button>
                </li>
              );
            })}
          </ul>
        ))}
      </div>
      <div className="rail-foot">
        <UpdateButton />
        <button type="button" className="rail-item" aria-label="搜索和切换" data-tip="搜索和切换 ⌘K"
          data-tip-side="right" onClick={props.onSearch}>
          <Icon name="search" size={20} />
        </button>
        <button type="button" className="rail-item" aria-label="新建…" data-tip="新建" data-tip-side="right"
          aria-expanded={menu !== null} onClick={(event) => setMenu(anchorOf(event.currentTarget))}>
          <Icon name="plus" size={20} />
        </button>
        <button type="button" className="rail-item rail-account"
          aria-label={offline ? `设置 · ${props.accountName} · ${CONNECTION_TEXT[props.connection]}`
            : `设置 · ${props.accountName}`}
          data-tip={offline ? `${props.accountName} · ${CONNECTION_TEXT[props.connection]}` : props.accountName}
          data-tip-side="right" onClick={props.onSettings}>
          {props.accountAvatar === null
            ? <span className="rail-avatar" aria-hidden="true">{accountInitial(props.accountName)}</span>
            : <img className="rail-avatar rail-avatar-image" src={props.accountAvatar} alt="" aria-hidden="true" />}
          {offline ? <span className="rail-signal" data-status={props.connection} aria-hidden="true" /> : null}
        </button>
      </div>
      {menu === null ? null : (
        <Popover anchor={menu} role="menu" align="start" label="新建" onClose={() => setMenu(null)}>
          {NEW_ITEMS.map((item) => (
            <MenuItem key={item.kind} icon={item.icon}
              label={item.kind === 'ask' ? `跟 ${mainName} 说` : item.label} onSelect={() => {
              setMenu(null);
              props.onNew(item.kind);
            }} />
          ))}
        </Popover>
      )}
    </nav>
  );
}
