// 联系人的头像（第 109 条符号词汇表「圆头像 = 人，圆角方块 = 系统与来源」）：人是圆的——有头像（data URL，对方加密
// 发来的）画图，没有写名字的第一个字；群是圆角方块（2026-11-05）：换过群头像画那张，没换拿前 9 个成员拼——1 个整张、
// 2–4 个 2×2、5–9 个 3×3；邮件是圆角方块里一个信封；系统来源各自一个图标。纯装饰，名字总在旁边。

import type { CSSProperties, ReactNode } from 'react';
import type { ContactRow, MemberFace } from '../../api/shared.ts';
import { Icon, type IconName } from '../../shell/icons.tsx';

const SOURCE_ICONS: Readonly<Record<string, IconName>> = {
  patrol: 'sparkle',
  feedback: 'thread',
  'cyber-hunter': 'globe',
  interview: 'quote',
};

/** 群头像最多拼 9 个人。 */
export const GROUP_FACES_MAX = 9;

export function initialOf(name: string): string {
  return Array.from(name.trim())[0] ?? '·';
}

export function contactIcon(row: Pick<ContactRow, 'kind' | 'address'>): IconName {
  if (row.kind === 'mail') {
    return 'mail';
  }
  return SOURCE_ICONS[row.address ?? ''] ?? 'tools';
}

/** 头像里那个字的字号档（只用令牌表里的字号，contacts.css 按 data-step 给）：24–28 小、36–44 中、56 大、72 特大。 */
export function avatarStep(size: number): 's' | 'm' | 'l' | 'xl' {
  if (size <= 28) {
    return 's';
  }
  if (size <= 44) {
    return 'm';
  }
  return size <= 56 ? 'l' : 'xl';
}

/** 拼群头像几乘几：1 个 → 1，2–4 个 → 2，5–9 个 → 3。 */
export function gridOf(count: number): 1 | 2 | 3 {
  if (count <= 1) {
    return 1;
  }
  return count <= 4 ? 2 : 3;
}

/** 一个人的圆头像：有图画图，没图写首字。 */
export function FaceAvatar({ name, avatar, size }: { name: string; avatar: string | null | undefined; size: number })
  : ReactNode {
  const style = { width: size, height: size } as CSSProperties;
  if (avatar !== null && avatar !== undefined) {
    return <img className="contact-avatar contact-avatar-image" src={avatar} alt="" style={style} aria-hidden="true" />;
  }
  return (
    <span className="contact-avatar" data-step={avatarStep(size)} style={style} aria-hidden="true">
      {initialOf(name)}
    </span>
  );
}

/** 群头像：换过的那张，或者前 9 个成员拼成的圆角方块。 */
export function GroupAvatar({ members, avatar, size }: { members: readonly MemberFace[];
  avatar: string | null | undefined; size: number }): ReactNode {
  const style = { width: size, height: size } as CSSProperties;
  if (avatar !== null && avatar !== undefined) {
    return <img className="group-avatar group-avatar-image" src={avatar} alt="" style={style} aria-hidden="true" />;
  }
  const shown = members.slice(0, GROUP_FACES_MAX);
  const grid = gridOf(shown.length);
  return (
    <span className="group-avatar" data-grid={grid} style={style} aria-hidden="true">
      {shown.map((member) => member.avatar === null
        ? <span key={member.accountId} className="group-avatar-cell">{initialOf(member.name)}</span>
        : <img key={member.accountId} className="group-avatar-cell" src={member.avatar} alt="" />)}
    </span>
  );
}

export function ContactAvatar({ row, size }: { row: Pick<ContactRow, 'kind' | 'name' | 'address'>
  & Partial<Pick<ContactRow, 'avatar' | 'members'>>; size: number }): ReactNode {
  if (row.kind === 'person') {
    return <FaceAvatar name={row.name} avatar={row.avatar} size={size} />;
  }
  if (row.kind === 'group') {
    return <GroupAvatar members={row.members ?? []} avatar={row.avatar} size={size} />;
  }
  const style = { width: size, height: size } as CSSProperties;
  return (
    <span className="contact-avatar contact-avatar-square" style={style} aria-hidden="true">
      <Icon name={contactIcon(row)} size={size >= 40 ? 18 : 16} />
    </span>
  );
}
