// 消息右边整块（手机上一整页）的四样（2026-11-05 设计稿 Add-Friend / New-Group / Invite / Friend-Request，
// Phone-Add-Friend / Phone-New-Group）：加好友（按账号号找、附一句、加好友；或者让对方扫我的链接）、新建群聊（勾好友、
// 群名可选、建群）、邀请朋友加入网络（一段能直接发的话：去哪下载、装好后加我的 @账号）、新请求（谁、他说的那句、关系、
// 接受 / 忽略）。头上一行标题 + 关掉（手机是返回）。

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useApi } from '../../api/context.tsx';
import type { ContactLookupResponse, ContactRow } from '../../api/shared.ts';
import { useLive } from '../../live.tsx';
import { OpLine } from '../../primitives/task-row/op-line.tsx';
import { isOpenOp } from '../../state/action-ops.ts';
import { CONTACT_ADD_OP_KEY, GROUP_CREATE_OP_KEY } from '../../state/contacts-action-requests.ts';
import { useClientState } from '../../state/context.tsx';
import { useStore } from '../../state/use-store.ts';
import { IconButton } from '../../shell/icon-button.tsx';
import { Icon } from '../../shell/icons.tsx';
import { useOp } from '../pending/pending-ops.tsx';
import { addDraftKey } from './contact-actions.ts';
import { FaceAvatar } from './contact-avatar.tsx';
import { groupDraftKey } from './network-transmit.ts';
import { QrCode } from './qr-code.tsx';
import './network.css';

/** 打字停这么久再去中继找人。 */
const LOOKUP_DELAY_MS = 300;

export function NetPane({ title, phone, onClose, children, foot }: { title: string; phone: boolean;
  onClose: () => void; children: ReactNode; foot?: ReactNode }): ReactNode {
  return (
    <section className="net-pane" aria-label={title}>
      <header className="net-pane-head">
        {phone ? <IconButton icon="back" size={20} label="回到消息" onClick={onClose} /> : null}
        <h2>{title}</h2>
        {phone ? null : <IconButton icon="close" label={`关掉${title}`} onClick={onClose} />}
      </header>
      <div className="net-pane-body">{children}</div>
      {foot}
    </section>
  );
}

function CopyRow({ text }: { text: string }): ReactNode {
  const [copied, setCopied] = useState(false);
  return (
    <div className="net-copy">
      <span>{text}</span>
      <IconButton icon={copied ? 'check' : 'copy'} label={copied ? '复制好了' : '复制'} onClick={() => {
        void navigator.clipboard?.writeText(text).then(() => setCopied(true));
      }} />
    </div>
  );
}

function useMyHost(): string | null {
  const api = useApi();
  const [host, setHost] = useState<string | null>(null);
  useEffect(() => {
    const abort = new AbortController();
    api.network.status(abort.signal).then((status) => setHost(status.account?.host ?? null))
      .catch((cause: unknown) => console.warn('读不到自己的账号地址，加好友页先不画二维码', cause));
    return () => abort.abort();
  }, [api]);
  return host;
}

function useLookup(handle: string): ContactLookupResponse | null {
  const api = useApi();
  const [found, setFound] = useState<ContactLookupResponse | null>(null);
  useEffect(() => {
    if (handle.trim().length < 3) {
      setFound(null);
      return;
    }
    const abort = new AbortController();
    const timer = setTimeout(() => {
      api.contacts.lookup(handle, abort.signal).then(setFound)
        .catch((cause: unknown) => console.warn('找人这次没成，等再打一个字', cause));
    }, LOOKUP_DELAY_MS);
    return () => {
      clearTimeout(timer);
      abort.abort();
    };
  }, [api, handle]);
  return found;
}

export function AddFriendPage({ phone, onClose, onAdded }: { phone: boolean; onClose: () => void;
  onAdded: (id: string) => void }): ReactNode {
  const { contactActions } = useLive();
  const { inlineDrafts, actionOps } = useClientState();
  const drafts = useStore(inlineDrafts.store);
  const op = useOp(CONTACT_ADD_OP_KEY);
  const locked = op !== undefined && isOpenOp(op);
  const handle = drafts.get(addDraftKey('handle')) ?? '';
  const found = useLookup(handle);
  const host = useMyHost();
  const link = host === null ? null : `${host}/add`;
  const add = async (): Promise<void> => {
    const id = await contactActions.add();
    if (id !== null) {
      onAdded(id);
    }
  };
  const button = (
    <button type="submit" className={`primary-button${phone ? ' net-wide' : ''}`}
      disabled={locked || handle.trim() === ''}>加好友</button>
  );
  return (
    <NetPane title="加好友" phone={phone} onClose={onClose}>
      <form className="net-form" onSubmit={(event) => {
        event.preventDefault();
        void add();
      }}>
        <label className="field">
          <span className="field-label">按账号号找</span>
          <span className="net-handle">
            <span>@</span>
            <input aria-label="账号号或链接" value={handle} autoFocus={!phone} disabled={locked}
              onChange={(event) => inlineDrafts.set(addDraftKey('handle'), event.target.value)} />
          </span>
        </label>
        {found?.account === null || found === null ? null : (
          <div className="net-person">
            <FaceAvatar name={found.account.displayName} avatar={null} size={40} />
            <span className="net-person-name">{found.account.displayName}<small>@{found.account.handle}</small></span>
          </div>
        )}
        {found !== null && found.account === null ? <p className="nt-status" role="status">网络上没有这个账号</p> : null}
        <label className="field">
          <span className="field-label">附一句话<small>（可选）</small></span>
          <textarea className="field-input" rows={2} value={drafts.get(addDraftKey('note')) ?? ''} disabled={locked}
            onChange={(event) => inlineDrafts.set(addDraftKey('note'), event.target.value)} />
        </label>
        <div className="net-actions">{button}</div>
        {op === undefined || op.status === 'running' ? null : (
          <OpLine op={op} onRetry={(key) => void contactActions.retry(key)} onDismiss={(key) => actionOps.dismiss(key)} />
        )}
        {link === null ? null : (
          <>
            <p className="net-or">或者</p>
            <div className="net-scan">
              <QrCode text={`https://${link}`} size={phone ? 104 : 120} />
              <div className="net-scan-side">
                让对方扫我
                <CopyRow text={link} />
              </div>
            </div>
          </>
        )}
      </form>
    </NetPane>
  );
}

export function NewGroupPage({ phone, onClose, onCreated }: { phone: boolean; onClose: () => void;
  onCreated: (id: string) => void }): ReactNode {
  const { contacts, contactActions } = useLive();
  const { inlineDrafts, actionOps } = useClientState();
  const drafts = useStore(inlineDrafts.store);
  const list = useStore(contacts.list.data);
  const op = useOp(GROUP_CREATE_OP_KEY);
  const locked = op !== undefined && isOpenOp(op);
  const [picked, setPicked] = useState<string[]>([]);
  const query = drafts.get(groupDraftKey('query')) ?? '';
  const friends = useMemo(() => (list.value?.contacts ?? []).filter((row: ContactRow) => row.kind === 'person'
    && row.state === 'active'), [list.value]);
  const shown = friends.filter((row) => query.trim() === '' || row.name.includes(query.trim())
    || (row.handle ?? '').includes(query.trim().toLowerCase()));
  const names = friends.filter((row) => picked.includes(row.id)).slice(0, 3).map((row) => row.name).join('、');
  const create = async (): Promise<void> => {
    const id = await contactActions.createGroup(picked);
    if (id !== null) {
      onCreated(id);
    }
  };
  const submit = (
    <button type="button" className="primary-button" disabled={locked || picked.length === 0}
      onClick={() => void create()}>建群</button>
  );
  const count = picked.length === 0 ? null : <span className="net-count">已选 {picked.length}</span>;
  return (
    <NetPane title="新建群聊" phone={phone} onClose={onClose}
      foot={phone ? <div className="net-phone-foot">{count ?? <span />}{submit}</div> : undefined}>
      <div className="net-form">
        <label className="net-search">
          <Icon name="search" size={14} />
          <input aria-label="找联系人" placeholder="找联系人" value={query}
            onChange={(event) => inlineDrafts.set(groupDraftKey('query'), event.target.value)} />
        </label>
        <div className="net-pick" role="group" aria-label="拉谁进群">
          {shown.map((row) => (
            <label key={row.id}>
              <input type="checkbox" checked={picked.includes(row.id)} disabled={locked}
                onChange={(event) => setPicked(event.target.checked ? [...picked, row.id]
                  : picked.filter((id) => id !== row.id))} />
              <FaceAvatar name={row.name} avatar={row.avatar} size={32} />
              <span className="net-person-name">{row.name}<small>@{row.handle}</small></span>
            </label>
          ))}
        </div>
        <label className="field">
          <span className="field-label">群名<small>（可选）</small></span>
          <input className="field-input" value={drafts.get(groupDraftKey('name')) ?? ''} placeholder={names}
            maxLength={40} disabled={locked} onChange={(event) => inlineDrafts.set(groupDraftKey('name'),
              event.target.value)} />
        </label>
        {phone ? null : <div className="net-actions">{submit}{count}</div>}
        {op === undefined || op.status === 'running' ? null : (
          <OpLine op={op} onRetry={(key) => void contactActions.retry(key)} onDismiss={(key) => actionOps.dismiss(key)} />
        )}
      </div>
    </NetPane>
  );
}

/** 发给朋友的那段话：去哪下载、装好后加谁。入网不要邀请码（11-08），11-13 Aaron 定把码去掉。 */
export function inviteText(handle: string, host: string | undefined): string {
  const site = host === undefined || !host.includes('.') ? 'cyberhunter.top' : host.slice(host.indexOf('.') + 1);
  return `我在用 Plasticine，邀请你加入。\n下载：https://${site}/download/\n装好后加我 @${handle}`;
}

export function InvitePage({ phone, onClose }: { phone: boolean; onClose: () => void }): ReactNode {
  const { network } = useLive();
  const status = useStore(network.status.data);
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    network.status.open();
  }, [network]);
  const account = status.value?.account ?? null;
  const text = account === null ? null : inviteText(account.handle, account.host);
  return (
    <NetPane title="邀请朋友加入网络" phone={phone} onClose={onClose}>
      <div className="net-form">
        {status.error === null ? null : <p className="block-empty is-error" role="alert">{status.error}</p>}
        {status.value !== null && account === null
          ? <p className="block-empty">先在「设置 · 账号」里起一个 @账号，朋友才加得到你。</p> : null}
        {text === null ? null : (
          <>
            <div className="field">
              <span className="field-label">发给朋友的话</span>
              <p className="net-share">{text}</p>
            </div>
            <div className="net-actions">
              <button type="button" className="primary-button" onClick={() => {
                void navigator.clipboard?.writeText(text).then(() => setCopied(true));
              }}><Icon name={copied ? 'check' : 'copy'} size={14} />{copied ? '复制好了' : '复制这段话'}</button>
            </div>
          </>
        )}
      </div>
    </NetPane>
  );
}
