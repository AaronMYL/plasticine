// 设置 · 账号最上面两行（11-08 设计稿 Settings-Account）：
//   名字一行  头像 · 名字 · 下面「@账号 · 地址」·「换头像」「改名字」（就地改名字，PATCH /v2/account）；没加入网络的，这里
//            「起一个 @账号」（自助注册，不要邀请码：11-08 决定 4），输入时照建账号页一样问能不能用；
//            换头像（11-13 从单独一块并进来）：挑一张图 → 圆形裁剪框 → 保存后加密随资料发给每个好友；有 @账号才能换；
//   密码一行  「改密码」就地展开：要旧密码；桌面客户端本机（有本机令牌）和还没设过密码的不要。
// 出错就地一行，不弹框。

import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { useApi } from '../../api/context.tsx';
import { errorText } from '../../api/errors.ts';
import { DISPLAY_NAME_MAX_CHARS, PASSWORD_MIN_CHARS, type AccountState } from '../../api/shared.ts';
import { useLive, useTimeZone } from '../../live.tsx';
import { hostLocalGrant } from '../../shell/host.ts';
import { useClientState } from '../../state/context.tsx';
import { NETWORK_JOIN_OP_KEY } from '../../state/contacts-action-requests.ts';
import { useStore } from '../../state/use-store.ts';
import { OpLine } from '../../primitives/task-row/op-line.tsx';
import { FaceAvatar } from '../contacts/contact-avatar.tsx';
import { HandleField, handleBlocks, normalizeHandle, useHandleCheck } from '../onboard/handle-field.tsx';
import { PasswordField } from '../onboard/onboard-parts.tsx';
import { useOp } from '../pending/pending-ops.tsx';
import { joinDraftKey } from './network-store.ts';
import { AvatarCrop } from './avatar-crop.tsx';
import { useSettingsDraft } from './settings-dialog-context.ts';
import './account-profile.css';
import { PageLoading } from '../../primitives/page-loading/index.tsx';

const AVATAR_SIZE = 44;

/** 「11月8日」：密码哪天设的。 */
function dayOf(iso: string, timeZone: string | undefined): string {
  return new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric', timeZone }).format(new Date(iso));
}

function hostOf(url: string | null): string | null {
  if (url === null) return null;
  try {
    return new URL(url).host;
  } catch (cause) {
    console.warn('账号网址解不开，不显示', cause);
    return null;
  }
}

function RenameForm({ name, onDone }: { name: string; onDone: (state: AccountState | null) => void }): ReactNode {
  const api = useApi();
  const [value, setValue] = useState(name);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useSettingsDraft(value.trim() !== name, () => onDone(null));
  const submit = (event: FormEvent): void => {
    event.preventDefault();
    if (value.trim() === '') return;
    setBusy(true);
    api.account.rename(value.trim()).then(onDone, (cause: unknown) => {
      setBusy(false);
      setError(errorText(cause));
    });
  };
  return (
    <form className="account-inline" onSubmit={submit} aria-label="改名字">
      <label className="field">
        <span className="field-label">名字</span>
        <input className="field-input" value={value} autoFocus maxLength={DISPLAY_NAME_MAX_CHARS} disabled={busy}
          onChange={(event) => setValue(event.target.value)} />
      </label>
      {error === null ? null : <p className="block-empty is-error" role="alert">{error}</p>}
      <div className="account-inline-actions">
        <button type="button" className="text-button text-button-quiet" onClick={() => onDone(null)}>取消</button>
        <button type="submit" className="primary-button button-small" disabled={busy || value.trim() === ''}>
          保存</button>
      </div>
    </form>
  );
}

/** 没加入网络：起一个 @账号（等于在网络里注册，不要邀请码）。 */
function ClaimHandle({ name, onDone }: { name: string; onDone: () => void }): ReactNode {
  const { networkActions } = useLive();
  const { inlineDrafts, actionOps } = useClientState();
  const drafts = useStore(inlineDrafts.store);
  const op = useOp(NETWORK_JOIN_OP_KEY);
  const raw = drafts.get(joinDraftKey('handle')) ?? '';
  const handle = normalizeHandle(raw);
  const check = useHandleCheck(handle);
  const busy = op?.status === 'running';
  useSettingsDraft(raw.trim() !== '', () => inlineDrafts.clear(joinDraftKey('handle')));
  const submit = (event: FormEvent): void => {
    event.preventDefault();
    if (handle === '' || handleBlocks(check)) return;
    inlineDrafts.set(joinDraftKey('handle'), handle);
    inlineDrafts.set(joinDraftKey('displayName'), name);
    inlineDrafts.clear(joinDraftKey('inviteCode'));
    void networkActions.join().then((joined) => {
      if (joined) onDone();
    });
  };
  return (
    <form className="account-inline" onSubmit={submit} aria-label="起一个 @账号">
      <HandleField id="settings-handle" value={raw} check={check} disabled={busy}
        onChange={(value) => inlineDrafts.set(joinDraftKey('handle'), value)} />
      {op === undefined || op.status === 'running' ? null : (
        <OpLine op={op} onRetry={(key) => void networkActions.retry(key)} onDismiss={(key) => actionOps.dismiss(key)} />
      )}
      <div className="account-inline-actions">
        <button type="button" className="text-button text-button-quiet" onClick={onDone}>取消</button>
        <button type="submit" className="primary-button button-small"
          disabled={busy || handle === '' || handleBlocks(check)}>起这个</button>
      </div>
    </form>
  );
}

function PasswordForm({ needsCurrent, localToken, onDone }: { needsCurrent: boolean; localToken: string | null;
  onDone: (setAt: string | null) => void }): ReactNode {
  const api = useApi();
  const [current, setCurrent] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useSettingsDraft(current !== '' || password !== '', () => onDone(null));
  const ready = !busy && password.length >= PASSWORD_MIN_CHARS && (!needsCurrent || current !== '');
  const submit = (event: FormEvent): void => {
    event.preventDefault();
    if (!ready) return;
    setBusy(true);
    setError(null);
    api.account.setPassword(needsCurrent ? { current, password } : { password }, localToken)
      .then((answer) => onDone(answer.passwordSetAt), (cause: unknown) => {
        setBusy(false);
        setError(errorText(cause));
      });
  };
  return (
    <form className="account-inline" onSubmit={submit} aria-label="改密码">
      {needsCurrent ? <PasswordField id="settings-password-current" label="旧密码" value={current}
        onChange={setCurrent} autoComplete="current-password" autoFocus disabled={busy} /> : null}
      <PasswordField id="settings-password-new" label="新密码" value={password} onChange={setPassword}
        autoComplete="new-password" autoFocus={!needsCurrent} disabled={busy} />
      {password.length > 0 && password.length < PASSWORD_MIN_CHARS
        ? <p className="ob-note">至少 {PASSWORD_MIN_CHARS} 位</p> : null}
      {error === null ? null : <p className="block-empty is-error" role="alert">{error}</p>}
      <p className="ob-note">别的设备照常登录着；要哪台退出，在下面的设备里点。</p>
      <div className="account-inline-actions">
        <button type="button" className="text-button text-button-quiet" onClick={() => onDone(null)}>取消</button>
        <button type="submit" className="primary-button button-small" disabled={!ready}>保存</button>
      </div>
    </form>
  );
}

type Editing = 'name' | 'handle' | 'password' | null;

export function AccountProfile(): ReactNode {
  const api = useApi();
  const { network, contactActions } = useLive();
  const timeZone = useTimeZone();
  const [state, setState] = useState<AccountState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<Editing>(null);
  const [localToken, setLocalToken] = useState<string | null>(null);
  const [setAt, setSetAt] = useState<string | null>(null);
  const [round, setRound] = useState(0);
  useEffect(() => {
    network.status.open();
  }, [network]);
  useEffect(() => {
    const controller = new AbortController();
    api.account.state(controller.signal).then((value) => {
      if (!controller.signal.aborted) setState(value);
    }, (cause: unknown) => {
      if (!controller.signal.aborted) setError(errorText(cause));
    });
    void hostLocalGrant().then(setLocalToken);
    return () => controller.abort();
  }, [api, round]);
  const name = state?.displayName ?? '';
  // 头像在网络状态里（设置 · 账号下面「头像」那块换的），和图标栏读同一份。
  const status = useStore(network.status.data).value;
  const avatar = status?.account?.avatar ?? null;
  const [cropping, setCropping] = useState<File | null>(null);
  const picker = useRef<HTMLInputElement>(null);
  const host = hostOf(state?.networkUrl ?? null);
  const reread = (): void => {
    setEditing(null);
    setRound((value) => value + 1);
  };
  return (
    <section className="block account-profile" aria-label="名字和密码">
      {state === null && error === null ? <PageLoading rows={3} dense /> : null}
      {error === null ? null : <p className="block-empty is-error" role="alert">{error}</p>}
      {/* 和中继同步出的错（有才写）：原来在「邀请朋友」那一块，11-13 那块去掉后挪到这里。 */}
      {status?.lastError == null ? null : <p className="block-empty is-error" role="alert">{status.lastError}</p>}
      {state === null ? null : <ul className="system-rows">
        <li className="system-row account-row">
          <FaceAvatar name={name === '' ? '?' : name} avatar={avatar} size={AVATAR_SIZE} />
          <span className="account-device-main">
            <span className="system-row-title">{name === '' ? '没起名字' : name}</span>
            <span className="text-meta account-device-meta">
              {state.handle === null ? '还没有 @账号' : `@${state.handle}${host === null ? '' : ` · ${host}`}`}
            </span>
          </span>
          {state.handle === null ? <button type="button" className="secondary-button button-small"
            aria-expanded={editing === 'handle'} onClick={() => setEditing('handle')}>起一个 @账号</button> : null}
          {/* 头像只给网络上的人看：有 @账号才能换。 */}
          {status?.account == null ? null : <>
            <button type="button" className="secondary-button button-small"
              onClick={() => picker.current?.click()}>换头像</button>
            <input ref={picker} type="file" accept="image/*" hidden aria-label="挑一张头像" onChange={(event) => {
              const picked = event.target.files?.[0];
              if (picked !== undefined) setCropping(picked);
              event.target.value = '';
            }} />
          </>}
          <button type="button" className="secondary-button button-small"
            aria-expanded={editing === 'name'} onClick={() => setEditing('name')}>改名字</button>
        </li>
        {cropping === null ? null : <li className="account-edit">
          <AvatarCrop file={cropping} shape="circle" onCancel={() => setCropping(null)} onSave={(dataUrl) => {
            setCropping(null);
            void contactActions.setAvatar(dataUrl).then(() => network.status.reload());
          }} />
        </li>}
        {editing === 'name' ? <li className="account-edit"><RenameForm name={name} onDone={(next) => {
          if (next === null) setEditing(null);
          else {
            setState(next);
            setEditing(null);
            // 图标栏、首页问候读的是网络状态里的名字：重读它，名字立刻跟着变。
            void network.status.reload();
          }
        }} /></li> : null}
        {editing === 'handle' ? <li className="account-edit"><ClaimHandle name={name} onDone={reread} /></li> : null}
        <li className="system-row account-row">
          <span className="system-row-title">密码</span>
          <span className="system-row-meta">
            {setAt !== null ? `${dayOf(setAt, timeZone)}设的` : state.passwordSet ? '' : '还没设'}
          </span>
          <button type="button" className="secondary-button button-small" aria-expanded={editing === 'password'}
            onClick={() => setEditing('password')}>{state.passwordSet ? '改密码' : '设密码'}</button>
        </li>
        {editing === 'password' ? <li className="account-edit">
          <PasswordForm needsCurrent={state.passwordSet && localToken === null} localToken={localToken}
            onDone={(at) => {
              setEditing(null);
              if (at !== null) {
                setSetAt(at);
                setState({ ...state, passwordSet: true });
              }
            }} />
        </li> : null}
      </ul>}
    </section>
  );
}
