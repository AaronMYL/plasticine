// 第一次打开（2026-11-05 设计稿 Friend-Onboard）：连上模型以后（connect-page.tsx 是第 1 步），还没加入 Cyber Hunter
// 网络的新装实例接着两步——加入网络（名字、账号 ⓘ、邀请码；中继本机的第一个账号不要码），在手机上打开（二维码 +
// <handle>.cyberhunter.top，证书经隧道拿到了就能扫；还在拿时一行小字说在拿）。「完成」以后不再出现（记在这台设备上）。
// 顶上一条三段的进度。读不到网络状态时不挡。

import { useEffect, useState, type ReactNode } from 'react';
import { NETWORK_HANDLE_PATTERN } from '../../api/shared.ts';
import { useLive } from '../../live.tsx';
import { isOpenOp } from '../../state/action-ops.ts';
import { NETWORK_JOIN_OP_KEY } from '../../state/contacts-action-requests.ts';
import { useClientState } from '../../state/context.tsx';
import { useStore } from '../../state/use-store.ts';
import { OpLine } from '../../primitives/task-row/op-line.tsx';
import { InfoTip } from '../../shell/info-tip.tsx';
import { IconButton } from '../../shell/icon-button.tsx';
import { Spinner } from '../lines/line-parts.tsx';
import { QrCode } from '../contacts/qr-code.tsx';
import { useOp } from '../pending/pending-ops.tsx';
import { joinDraftKey } from '../settings/network-store.ts';
import './models.css';

/** 这台设备上走完过一遍（或跳过）：不再出现。 */
export const ONBOARD_DONE_KEY = 'plasticine.onboard.network';
const HANDLE = new RegExp(NETWORK_HANDLE_PATTERN);
const QR_SIZE = 148;

function done(): boolean {
  try {
    return window.localStorage.getItem(ONBOARD_DONE_KEY) === '1';
  } catch {
    return false;
  }
}

function markDone(): void {
  try {
    window.localStorage.setItem(ONBOARD_DONE_KEY, '1');
  } catch (cause) {
    console.warn('记不下「第一次打开走完了」，下次打开还会出现', cause);
  }
}

export function Stepper({ at }: { at: 1 | 2 | 3 }): ReactNode {
  return (
    <div className="onboard-steps" role="img" aria-label={`第 ${at} 步，共 3 步`}>
      {[1, 2, 3].map((step) => <span key={step} data-done={step <= at} />)}
    </div>
  );
}

function JoinStep({ inviteNeeded, onSkip }: { inviteNeeded: boolean; onSkip: () => void }): ReactNode {
  const { networkActions } = useLive();
  const { inlineDrafts, actionOps } = useClientState();
  const drafts = useStore(inlineDrafts.store);
  const op = useOp(NETWORK_JOIN_OP_KEY);
  const locked = op !== undefined && isOpenOp(op);
  const handle = (drafts.get(joinDraftKey('handle')) ?? '').trim().replace(/^@/, '');
  const name = (drafts.get(joinDraftKey('displayName')) ?? '').trim();
  const bad = handle !== '' && !HANDLE.test(handle);
  return (
    <form className="onboard-form" aria-label="加入网络" onSubmit={(event) => {
      event.preventDefault();
      void networkActions.join();
    }}>
      <Stepper at={2} />
      <h1 className="connect-title">加入网络</h1>
      <label className="field">
        <span className="field-label">名字</span>
        <input className="field-input" value={drafts.get(joinDraftKey('displayName')) ?? ''} disabled={locked}
          maxLength={40} onChange={(event) => inlineDrafts.set(joinDraftKey('displayName'), event.target.value)} />
      </label>
      <label className="field">
        <span className="field-label">账号 <InfoTip text="朋友用它在网络里加你" label="账号的说明" /></span>
        <span className="net-handle"><span>@</span>
          <input aria-label="账号" value={drafts.get(joinDraftKey('handle')) ?? ''} disabled={locked}
            autoComplete="off" spellCheck={false}
            onChange={(event) => inlineDrafts.set(joinDraftKey('handle'), event.target.value.toLowerCase())} />
        </span>
      </label>
      {bad ? <p className="block-empty is-error" role="alert">3–24 位小写字母、数字或下划线</p> : null}
      {inviteNeeded ? (
        <label className="field">
          <span className="field-label">邀请码</span>
          <input className="field-input field-input-mono" value={drafts.get(joinDraftKey('inviteCode')) ?? ''}
            disabled={locked} autoComplete="off"
            onChange={(event) => inlineDrafts.set(joinDraftKey('inviteCode'), event.target.value)} />
        </label>
      ) : null}
      <button type="submit" className="primary-button onboard-wide"
        disabled={locked || bad || handle === '' || name === ''}>加入</button>
      {op === undefined || op.status === 'running' ? null : (
        <OpLine op={op} onRetry={(key) => void networkActions.retry(key)} onDismiss={(key) => actionOps.dismiss(key)} />
      )}
      <button type="button" className="text-button text-button-quiet onboard-skip" onClick={onSkip}>先跳过</button>
    </form>
  );
}

function PhoneStep({ host, tunnel, onDone }: { host: string; tunnel: string | null; onDone: () => void })
  : ReactNode {
  const [copied, setCopied] = useState(false);
  return (
    <div className="onboard-form">
      <Stepper at={3} />
      <h1 className="connect-title">在手机上打开</h1>
      <div className="onboard-qr"><QrCode text={`https://${host}`} size={QR_SIZE} /></div>
      <div className="net-copy">
        <span>{host}</span>
        <IconButton icon={copied ? 'check' : 'copy'} label={copied ? '复制好了' : '复制'} onClick={() => {
          void navigator.clipboard?.writeText(`https://${host}`).then(() => setCopied(true));
        }} />
      </div>
      {tunnel === null ? null : <p className="onboard-wait"><Spinner size={12} label="在拿证书" />{tunnel}</p>}
      <button type="button" className="primary-button onboard-wide" onClick={onDone}>完成</button>
    </div>
  );
}

/** 连上模型、还没加入网络的新装实例：先走完加入网络、在手机上打开两步。 */
export function OnboardGate({ children }: { children: ReactNode }): ReactNode {
  const { network } = useLive();
  const status = useStore(network.status.data);
  const [finished, setFinished] = useState(done);
  const [joinedHere, setJoinedHere] = useState(false);
  useEffect(() => {
    network.status.open();
  }, [network]);
  const value = status.value;
  useEffect(() => {
    if (value !== null && !value.joined && value.welcome === true) {
      setJoinedHere(true);
    }
  }, [value]);
  const finish = (): void => {
    markDone();
    setFinished(true);
  };
  if (finished || value === null || !joinedHere) {
    return children;
  }
  const account = value.account;
  const tunnel = value.tunnel ?? null;
  const waiting = tunnel === null || tunnel.state === 'ready' || tunnel.state === 'off' ? null
    : tunnel.state === 'error' ? `证书还没拿到：${tunnel.detail ?? '稍后自动再试'}` : '在经隧道拿证书…';
  return (
    <main className="connect-page" aria-label="第一次打开">
      <div className="connect-card">
        {account === null ? <JoinStep inviteNeeded={value.inviteNeeded} onSkip={finish} />
          : <PhoneStep host={account.host ?? `${account.handle}.cyberhunter.top`} tunnel={waiting} onDone={finish} />}
      </div>
    </main>
  );
}
