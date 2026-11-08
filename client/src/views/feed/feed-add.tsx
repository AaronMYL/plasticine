// 「加来源」对话框（第 7 批第 10 条，他定；设计稿 Feed-Add）：第二栏顶上的 + 是唯一入口。顶上五种：网址 · Reddit ·
// 关注点 · X 关注 · 抖音收藏。网址就是原来的加订阅（自己找订阅地址）；Reddit 填版块名、先看三条；关注点是原来的表单；
// X、抖音收藏要他在电脑上的 Plasticine 浏览器里登录，这里写登录状态、给「去登录」。

import type { ReactNode } from 'react';
import { useClientState } from '../../state/context.tsx';
import { FEED_ADD_KINDS, type FeedAddKind } from '../../state/feed-ui.ts';
import { useStore } from '../../state/use-store.ts';
import { Icon, type IconName } from '../../shell/icons.tsx';
import { FeedInterest } from './feed-interest.tsx';
import { LOGIN_SITES, useSiteLogins, type LoginKind } from './feed-nav-data.ts';
import { openLogin, RedditMark } from './feed-source-list.tsx';
import { FeedSubscription } from './feed-subscription.tsx';
import { RedditAdd } from './reddit-add.tsx';
import './feed-add.css';

const KIND_LABELS: Readonly<Record<FeedAddKind, string>> = {
  url: '网址',
  reddit: 'Reddit',
  interest: '关注点',
  x: 'X 关注',
  douyin: '抖音收藏',
};
const KIND_ICONS: Readonly<Record<Exclude<FeedAddKind, 'reddit'>, IconName>> = {
  url: 'link', interest: 'globe', x: 'hash', douyin: 'play',
};
const LOGIN_TEXT: Readonly<Record<LoginKind, { on: string; off: string; how: string }>> = {
  x: { on: '已登录 X', off: '还没登录 X',
    how: '电脑在线时，每 2 小时读一次你在 X 上关注的人。' },
  douyin: { on: '已登录抖音', off: '还没登录抖音',
    how: '同步时读你的抖音收藏，你勾选的才处理，处理好的进信息流。' },
};

function stateText(kind: LoginKind, signedIn: boolean | null): string {
  if (signedIn === null) {
    return `在电脑上的 Plasticine 浏览器里${LOGIN_SITES[kind].login}`;
  }
  return signedIn ? LOGIN_TEXT[kind].on : LOGIN_TEXT[kind].off;
}

/** X / 抖音：登录状态（电脑上看得到）+ 去登录；抖音多一个「选收藏…」。 */
export function LoginPanel({ kind, onDouyin }: { kind: LoginKind; onDouyin?: () => void }): ReactNode {
  const logins = useSiteLogins();
  const signedIn = logins?.[kind] ?? null;
  const text = LOGIN_TEXT[kind];
  return (
    <div className="feed-add-login">
      <p className="feed-add-login-state">
        {signedIn === null ? null : <span className="feed-add-login-dot" data-on={signedIn} aria-hidden="true" />}
        {stateText(kind, signedIn)}
      </p>
      <p className="feed-add-note">{text.how}</p>
      <div className="feed-add-login-actions">
        {signedIn === null ? null : (
          <button type="button" className={signedIn ? 'secondary-button' : 'primary-button'}
            onClick={() => openLogin(kind)}>{signedIn ? LOGIN_SITES[kind].open : '去登录'}</button>
        )}
        {onDouyin === undefined ? null : (
          <button type="button" className="secondary-button" onClick={onDouyin}>选收藏…</button>
        )}
      </div>
    </div>
  );
}

export function FeedAdd({ onClose, onDouyin }: { onClose: () => void; onDouyin: () => void }): ReactNode {
  const { feedUi } = useClientState();
  const kind = useStore(feedUi.store).addKind;
  return (
    <div className="feed-add">
      <div className="feed-add-kinds" role="tablist" aria-label="加什么来源">
        {FEED_ADD_KINDS.map((value) => (
          <button key={value} type="button" role="tab" className="feed-add-kind" aria-selected={kind === value}
            onClick={() => feedUi.setAddKind(value)}>
            {value === 'reddit' ? <RedditMark size={20} /> : <Icon name={KIND_ICONS[value]} size={20} />}
            <span>{KIND_LABELS[value]}</span>
          </button>
        ))}
      </div>
      <div className="feed-add-body" role="tabpanel" aria-label={KIND_LABELS[kind]} key={kind}>
        {kind === 'url' ? <FeedSubscription onAdded={onClose} /> : null}
        {kind === 'reddit' ? <RedditAdd onAdded={onClose} onCancel={onClose} /> : null}
        {kind === 'interest' ? <FeedInterest alwaysOpen /> : null}
        {kind === 'x' ? <LoginPanel kind="x" /> : null}
        {kind === 'douyin' ? <LoginPanel kind="douyin" onDouyin={onDouyin} /> : null}
      </div>
    </div>
  );
}
