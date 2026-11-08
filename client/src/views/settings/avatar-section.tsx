// 设置 · 账号 ·「头像」（2026-11-05 设计稿 Avatar）：一个大圆头像（没设过写名字首字）+「换头像」。挑一张图 → 裁剪框
// （圆形取景、可拖可缩放）→ 保存后加密随资料发给每个好友。没加入网络时不出现（头像只给网络上的人看）。

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useLive } from '../../live.tsx';
import { useStore } from '../../state/use-store.ts';
import { FaceAvatar } from '../contacts/contact-avatar.tsx';
import { AvatarCrop } from './avatar-crop.tsx';

const SIZE = 72;

export function AvatarSection(): ReactNode {
  const { network, contactActions } = useLive();
  const status = useStore(network.status.data);
  const [cropping, setCropping] = useState<File | null>(null);
  const file = useRef<HTMLInputElement>(null);
  useEffect(() => {
    network.status.open();
  }, [network]);
  const account = status.value?.account ?? null;
  if (account === null) {
    return null;
  }
  return (
    <section className="block" aria-labelledby="settings-avatar">
      <header className="block-head"><h3 id="settings-avatar" className="block-title">头像</h3></header>
      <div className="settings-avatar">
        <FaceAvatar name={account.displayName} avatar={account.avatar ?? null} size={SIZE} />
        <button type="button" className="chip-button" onClick={() => file.current?.click()}>换头像</button>
        <input ref={file} type="file" accept="image/*" hidden aria-label="挑一张头像" onChange={(event) => {
          const picked = event.target.files?.[0];
          if (picked !== undefined) {
            setCropping(picked);
          }
          event.target.value = '';
        }} />
      </div>
      {cropping === null ? null : (
        <AvatarCrop file={cropping} shape="circle" onCancel={() => setCropping(null)} onSave={(dataUrl) => {
          setCropping(null);
          void contactActions.setAvatar(dataUrl).then(() => network.status.reload());
        }} />
      )}
    </section>
  );
}
