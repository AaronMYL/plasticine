import { AVATAR_MAX_CHARS } from '../../shared/net-wire.ts';
import type { NetworkIdentity } from '../../shared/state.ts';
import { changeOf, requireIdentity, type NetworkContext } from './context.ts';
import { NetworkError } from './errors.ts';
import { enqueue } from './outbox.ts';
import { aiNameOf } from '../mates/index.ts';

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

export function broadcastProfile(context: NetworkContext, avatar: string | null): NetworkIdentity {
  return sendProfile(context, { avatar: checkAvatar(avatar) });
}

export function refreshProfile(context: NetworkContext): NetworkIdentity {
  return sendProfile(context, {});
}

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
