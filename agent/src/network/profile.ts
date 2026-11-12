// 头像（2026-11-05 他定）和名字（2026-11-08）：账号头像在本机裁成圆形小图（data URL），和名字一起加密发给每个好友（profile 信封；
// 加人时的 hello 也带上）。中继只看到「一封 profile」，看不到图。

import { AVATAR_MAX_CHARS } from '../../shared/net-wire.ts';
import type { NetworkIdentity } from '../../shared/state.ts';
import { changeOf, requireIdentity, type NetworkContext } from './context.ts';
import { NetworkError } from './errors.ts';
import { enqueue } from './outbox.ts';
import { aiNameOf } from '../mates/main-identity.ts';

const AVATAR_PATTERN = /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/;

export function checkAvatar(avatar: string | null): string | null {
  if (avatar === null) {
    return null;
  }
  if (avatar.length > AVATAR_MAX_CHARS || !AVATAR_PATTERN.test(avatar)) {
    throw new NetworkError('invalid_input', '头像要是裁好的小图（PNG、JPEG 或 WebP，64 KB 以内）。', 'avatar');
  }
  return avatar;
}

/** 换头像并发给每个好友。 */
export function broadcastProfile(context: NetworkContext, avatar: string | null): NetworkIdentity {
  return sendProfile(context, { avatar: checkAvatar(avatar) });
}

/** 主线改了名字（第 12 批）：再发一次资料，带上新的 AI 名字。 */
export function refreshProfile(context: NetworkContext): NetworkIdentity {
  return sendProfile(context, {});
}

/** 改名字（2026-11-08 设置 · 账号）：和头像同一封 profile 发给每个好友，他们那边的名字跟着变。 */
export function renameProfile(context: NetworkContext, displayName: string): NetworkIdentity {
  return sendProfile(context, { displayName });
}

function sendProfile(context: NetworkContext, patch: { avatar?: string | null; displayName?: string }):
  NetworkIdentity {
  return context.desk.commit((changes) => {
    const identity = requireIdentity(context);
    const updated = context.state.networkIdentity.update(identity.version, patch);
    const touched: string[] = [];
    for (const contact of context.state.contacts.active()) {
      enqueue(context, contact, { kind: 'profile', author: 'me', text: '', quiet: true,
        payload: { displayName: updated.displayName, avatar: updated.avatar, aiName: aiNameOf(context.state) } });
      touched.push(contact.id);
    }
    changes.afterCommit(() => {
      context.kickOutbox();
      for (const contactId of touched) {
        context.changed(changeOf(contactId));
      }
    });
    return updated;
  });
}
