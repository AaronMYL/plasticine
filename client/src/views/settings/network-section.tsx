// 设置 · 账号 ·「邀请朋友」（第 113 条）：加入了网络才有——和中继同步出的错（有才写）、「邀请朋友」生成一个码并给出一句
// 可以直接复制给朋友的话、发过的码（用掉的写是谁用的，没用的写哪天过期）。
// 11-08：@账号和名字挪到最上面的账号一行（account-profile.tsx），没加入的在那里自助起 @账号，不要邀请码；
// 下面这个加入表单只留给旧地址直接打开、还要邀请码的情形。

import { useEffect, type ReactNode } from 'react';
import { NETWORK_HANDLE_PATTERN, type NetworkInvite } from '../../api/shared.ts';
import { useLive, useTimeZone } from '../../live.tsx';
import { isOpenOp } from '../../state/action-ops.ts';
import { NETWORK_INVITE_OP_KEY, NETWORK_JOIN_OP_KEY } from '../../state/contacts-action-requests.ts';
import { useClientState } from '../../state/context.tsx';
import { useStore } from '../../state/use-store.ts';
import { OpLine } from '../../primitives/task-row/op-line.tsx';
import { StatusGlyph } from '../../shell/glyph.tsx';
import { LoadNote } from '../m5b/load-note.tsx';
import { useOp } from '../pending/pending-ops.tsx';
import { shortDate } from '../contacts/contact-time.ts';
import { joinDraftKey, type JoinField } from './network-store.ts';
import { CopyText } from './copy-text.tsx';
import { useSettingsDraft } from './settings-dialog-context.ts';

const HANDLE = new RegExp(NETWORK_HANDLE_PATTERN);

function JoinField({ field, label, placeholder, disabled }: { field: JoinField; label: string;
  placeholder?: string; disabled: boolean }): ReactNode {
  const { inlineDrafts } = useClientState();
  const drafts = useStore(inlineDrafts.store);
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      <input className={field === 'displayName' ? 'field-input' : 'field-input field-input-mono'}
        value={drafts.get(joinDraftKey(field)) ?? ''} placeholder={placeholder} disabled={disabled}
        autoComplete="off" spellCheck={false}
        onChange={(event) => inlineDrafts.set(joinDraftKey(field), event.target.value)} />
    </label>
  );
}

/** 没加入：@handle、显示名，要邀请码时再一栏邀请码（中继本机的第一个账号不要，不出这一栏）。 */
function JoinForm({ inviteNeeded }: { inviteNeeded: boolean }): ReactNode {
  const { networkActions } = useLive();
  const { inlineDrafts, actionOps } = useClientState();
  const drafts = useStore(inlineDrafts.store);
  const op = useOp(NETWORK_JOIN_OP_KEY);
  const locked = op !== undefined && isOpenOp(op);
  const handle = (drafts.get(joinDraftKey('handle')) ?? '').trim().replace(/^@/, '');
  const name = (drafts.get(joinDraftKey('displayName')) ?? '').trim();
  const badHandle = handle !== '' && !HANDLE.test(handle);
  const fields: JoinField[] = ['handle', 'displayName', 'inviteCode'];
  useSettingsDraft(!locked && fields.some((field) => (drafts.get(joinDraftKey(field)) ?? '').trim() !== ''),
    () => fields.forEach((field) => inlineDrafts.clear(joinDraftKey(field))));
  return (
    <form className="network-join" aria-label="加入网络" onSubmit={(event) => {
      event.preventDefault();
      void networkActions.join();
    }}>
      <JoinField field="handle" label="@handle" placeholder="alex" disabled={locked} />
      {badHandle ? <p className="block-empty is-error" role="alert">3–24 位小写字母、数字或下划线</p> : null}
      <JoinField field="displayName" label="显示名" disabled={locked} />
      {inviteNeeded ? <JoinField field="inviteCode" label="邀请码" placeholder="CH-XXXX-XXXX" disabled={locked} />
        : null}
      <button type="submit" className="primary-button network-join-submit"
        disabled={locked || handle === '' || name === '' || badHandle}>加入</button>
      {op === undefined ? null : <OpLine op={op} onRetry={(key) => void networkActions.retry(key)}
        onDismiss={(key) => actionOps.dismiss(key)} />}
    </form>
  );
}

function InviteRow({ invite }: { invite: NetworkInvite }): ReactNode {
  const timeZone = useTimeZone();
  return (
    <li className="network-invite-row">
      <span className="mono">{invite.code}</span>
      {/* 11-04 重做悬停：光一个日期看不出是什么，写成「11-10 过期」常显；用掉的勾 + 谁用的已经说清。 */}
      {invite.usedBy === null
        ? <span className="text-meta network-invite-meta">{shortDate(invite.expiresAt, timeZone)} 过期</span>
        : <span className="network-invite-used">
          <StatusGlyph status="done" label="用掉了" />
          <span className="mono">@{invite.usedBy}</span>
        </span>}
    </li>
  );
}

function Joined(): ReactNode {
  const { network, networkActions } = useLive();
  const { actionOps } = useClientState();
  const status = useStore(network.status.data).value;
  const invites = useStore(network.invites.data);
  const fresh = useStore(network.fresh);
  const op = useOp(NETWORK_INVITE_OP_KEY);
  const account = status?.account;
  if (account == null) {
    return null;
  }
  return (
    <>
      {status?.lastError == null ? null : <p className="block-empty is-error" role="alert">{status.lastError}</p>}
      <div className="network-invite">
        <button type="button" className="chip-button network-invite-button"
          disabled={op !== undefined && isOpenOp(op)} onClick={() => void networkActions.invite()}>邀请朋友</button>
        {op === undefined ? null : <OpLine op={op} onRetry={(key) => void networkActions.retry(key)}
          onDismiss={(key) => actionOps.dismiss(key)} />}
        {fresh === null ? null : (
          <div className="network-invite-fresh" aria-label="刚生成的邀请码">
            <span className="network-invite-code mono">{fresh.invite.code}</span>
            <p className="network-share">{fresh.shareText}</p>
            <CopyText text={fresh.shareText} label="复制这句话" />
          </div>
        )}
      </div>
      <LoadNote resource={invites} what="邀请码" onRetry={() => void network.invites.reload()} />
      {(invites.value ?? []).length === 0 ? null : (
        <ul className="network-invites" aria-label="发过的邀请码">
          {(invites.value ?? []).map((invite) => <InviteRow key={invite.code} invite={invite} />)}
        </ul>
      )}
    </>
  );
}

export function NetworkSection(): ReactNode {
  const { network } = useLive();
  const status = useStore(network.status.data);
  useEffect(() => {
    network.status.open();
    network.invites.open();
  }, [network]);
  // 没加入、也不要邀请码：在上面账号一行里起 @账号就行，这里整段不出现。
  if (status.value !== null && !status.value.joined && !status.value.inviteNeeded) {
    return null;
  }
  return (
    <section className="block" aria-labelledby="settings-network">
      <header className="block-head">
        <h3 id="settings-network" className="block-title">{status.value?.joined === false ? '加入网络' : '邀请朋友'}</h3>
      </header>
      <LoadNote resource={status} what="网络账号" onRetry={() => void network.status.reload()} />
      {status.value === null ? null : status.value.joined ? <Joined />
        : <JoinForm inviteNeeded={status.value.inviteNeeded} />}
    </section>
  );
}
