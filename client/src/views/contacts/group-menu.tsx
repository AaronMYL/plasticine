// 群聊头上的 ⋯（2026-11-05 设计稿 Group-Menu）：顶上一排成员小头像 + 人数；加人、改群名、换群头像；退出（点了先在
// 菜单里问一句「退出「杭州周末」？」并写清后果：退出后收不到这个群的消息，你发过的卡留在群里）。
// 加人是一个好友勾选列表；改群名是就地一个输入框；换群头像挑一张图，裁成方形小图（和账号头像同一个裁剪框）。

import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { ContactRow } from '../../api/shared.ts';
import { useLive } from '../../live.tsx';
import { useStore } from '../../state/use-store.ts';
import { IconButton } from '../../shell/icon-button.tsx';
import { Icon } from '../../shell/icons.tsx';
import { AvatarCrop } from '../settings/avatar-crop.tsx';
import { FaceStack } from './face-stack.tsx';

type Step = 'menu' | 'add' | 'rename' | 'leave';

function AddPeople({ group, onDone }: { group: ContactRow; onDone: () => void }): ReactNode {
  const { contacts, contactActions } = useLive();
  const list = useStore(contacts.list.data);
  const inGroup = new Set((group.members ?? []).map((member) => member.handle));
  const friends = (list.value?.contacts ?? []).filter((row) => row.kind === 'person' && row.state === 'active'
    && !inGroup.has(row.handle ?? ''));
  const [picked, setPicked] = useState<string[]>([]);
  if (friends.length === 0) {
    return <p className="nt-status group-menu-field">好友都在群里了</p>;
  }
  return (
    <div className="net-pick group-menu-field" role="group" aria-label="拉谁进群">
      {friends.map((row) => (
        <label key={row.id}>
          <input type="checkbox" checked={picked.includes(row.id)}
            onChange={(event) => setPicked(event.target.checked ? [...picked, row.id]
              : picked.filter((id) => id !== row.id))} />
          {row.name}
        </label>
      ))}
      <button type="button" className="primary-button" disabled={picked.length === 0}
        onClick={() => void contactActions.updateGroup(group, { addIds: picked }).then((done) => done && onDone())}>
        拉进群</button>
    </div>
  );
}

function Rename({ group, onDone }: { group: ContactRow; onDone: () => void }): ReactNode {
  const { contactActions } = useLive();
  const [name, setName] = useState(group.name);
  return (
    <form className="group-menu-field" onSubmit={(event) => {
      event.preventDefault();
      if (name.trim() !== '') {
        void contactActions.updateGroup(group, { name: name.trim() }).then((done) => done && onDone());
      }
    }}>
      <input className="field-input" aria-label="群名" value={name} autoFocus maxLength={40}
        onChange={(event) => setName(event.target.value)} />
      <button type="submit" className="primary-button" disabled={name.trim() === ''}>改</button>
    </form>
  );
}

export function GroupMenu({ group, onLeft }: { group: ContactRow; onLeft: () => void }): ReactNode {
  const { contactActions } = useLive();
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<Step>('menu');
  const [cropping, setCropping] = useState<File | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const file = useRef<HTMLInputElement>(null);
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
  const done = (): void => {
    setOpen(false);
    setStep('menu');
  };
  const members = group.members ?? [];
  return (
    <div ref={box} onKeyDown={(event) => {
      if (event.key === 'Escape') {
        done();
      }
    }}>
      <IconButton icon="more" label="群设置" aria-expanded={open} aria-pressed={open} onClick={() => {
        setStep('menu');
        setOpen(!open);
      }} />
      {open ? (
        <div className="group-menu" role="menu" aria-label={`${group.name}的设置`}>
          <div className="group-menu-members">
            <FaceStack faces={members} size={24} />
            <span>{group.memberCount ?? members.length} 人</span>
          </div>
          <button type="button" role="menuitem" className="add-menu-item" onClick={() => setStep('add')}>
            <Icon name="plus" size={16} />加人</button>
          {step === 'add' ? <AddPeople group={group} onDone={done} /> : null}
          <button type="button" role="menuitem" className="add-menu-item" onClick={() => setStep('rename')}>
            <Icon name="edit" size={16} />改群名</button>
          {step === 'rename' ? <Rename group={group} onDone={done} /> : null}
          <button type="button" role="menuitem" className="add-menu-item" onClick={() => file.current?.click()}>
            <Icon name="image" size={16} />换群头像</button>
          <input ref={file} type="file" accept="image/*" hidden aria-label="挑一张群头像" onChange={(event) => {
            const picked = event.target.files?.[0];
            if (picked !== undefined) {
              setCropping(picked);
            }
            event.target.value = '';
          }} />
          <hr />
          {step === 'leave' ? (
            <div className="group-menu-confirm" role="alertdialog" aria-label={`退出「${group.name}」？`}>
              <strong>退出「{group.name}」？</strong>
              <p>退出后收不到这个群的消息；你发过的卡留在群里</p>
              <div className="net-actions">
                <button type="button" className="primary-button" onClick={() => {
                  void contactActions.leaveGroup(group).then((left) => {
                    if (left) {
                      done();
                      onLeft();
                    }
                  });
                }}>退出</button>
                <button type="button" className="text-button text-button-quiet" onClick={() => setStep('menu')}>
                  取消</button>
              </div>
            </div>
          ) : (
            <button type="button" role="menuitem" className="add-menu-item" onClick={() => setStep('leave')}>
              <Icon name="back" size={16} />退出群</button>
          )}
        </div>
      ) : null}
      {cropping === null ? null : (
        <AvatarCrop file={cropping} shape="square" onCancel={() => setCropping(null)} onSave={(dataUrl) => {
          setCropping(null);
          void contactActions.updateGroup(group, { avatar: dataUrl }).then((saved) => saved && done());
        }} />
      )}
    </div>
  );
}
