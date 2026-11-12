// 第 12 批：消息列表里一个联系人那一行的「⋯」（右键这一行同一个菜单）：改备注 · 关联人物… · 查看资料 · 删除联系人。
// 改备注、删除见 contacts/contact-manage.tsx。列表最下面「最近删除」点开能逐个恢复。

import { useState, type ReactNode } from 'react';
import type { ContactRow } from '../../api/shared.ts';
import { useLive } from '../../live.tsx';
import { DropdownMenu, SEPARATOR } from '../../shell/dropdown-menu.tsx';
import { Icon } from '../../shell/icons.tsx';
import { ContactAvatar } from '../contacts/contact-avatar.tsx';

export interface ContactRowMenuProps {
  row: ContactRow;
  onRename: () => void;
  /** 打开资料栏；memory = 落到「记忆」那一节（关联人物）。 */
  onProfile: (memory: boolean) => void;
  onRemove: () => void;
}

export function ContactRowMenu({ row, onRename, onProfile, onRemove }: ContactRowMenuProps): ReactNode {
  return (
    <DropdownMenu label={`${row.name}的更多操作`} tip="更多" className="icon-button contact-row-menu" align="end"
      rowMenu items={[
        { label: '改备注', icon: 'edit', onSelect: onRename },
        { label: '关联人物…', icon: 'memory', onSelect: () => onProfile(true) },
        { label: '查看资料', icon: 'person', onSelect: () => onProfile(false) },
        SEPARATOR,
        { label: '删除联系人', icon: 'trash', danger: true, onSelect: onRemove },
      ]}>
      <Icon name="more" size={16} />
    </DropdownMenu>
  );
}

/** 列表最下面的「最近删除」：点开是删掉的联系人，每个一颗「恢复」。 */
export function RemovedContacts({ rows, phone }: { rows: readonly ContactRow[]; phone: boolean }): ReactNode {
  const { contactEdits } = useLive();
  const [open, setOpen] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  if (rows.length === 0) return null;
  return (
    <div className="contact-removed" data-open={open}>
      <button type="button" className="contact-removed-head" aria-expanded={open} onClick={() => setOpen(!open)}>
        <Icon name="trash" size={14} />
        <span>最近删除</span>
        <span className="mono">{rows.length}</span>
        <Icon name={open ? 'chevron-up' : 'chevron-down'} size={14} />
      </button>
      {open ? (
        <ul className="contact-removed-list" aria-label="最近删除的联系人">
          {rows.map((row) => (
            <li key={row.id} className="contact-removed-row">
              <ContactAvatar row={row} size={phone ? 36 : 28} />
              <span className="contact-removed-name">{row.name}</span>
              <button type="button" className="chip-button" onClick={() => {
                setProblem(null);
                void contactEdits.restore(row).then(setProblem);
              }}>恢复</button>
            </li>
          ))}
        </ul>
      ) : null}
      {problem === null ? null : <p className="contact-rename-error" role="alert">{problem}</p>}
    </div>
  );
}
