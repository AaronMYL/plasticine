import { useState, type ReactNode } from 'react';
import { useApi } from '../../api/context.tsx';
import type { NetworkStatus } from '../../api/shared.ts';
import { useLive, useTimeZone } from '../../live.tsx';
import { Sheet } from '../../primitives/sheet/index.tsx';
import { OpLines } from '../../primitives/task-row/op-line.tsx';
import { formatClock } from '../../primitives/message/states.ts';
import { StatusGlyph } from '../../shell/glyph.tsx';
import { Icon } from '../../shell/icons.tsx';
import { usePhone } from '../../shell/use-viewport-width.ts';
import { useClientState } from '../../state/context.tsx';
import { NODE_CODE_KEY } from '../../state/m5-action-requests.ts';
import { useStore } from '../../state/use-store.ts';
import { QrCode } from '../contacts/qr-code.tsx';
import { pairingAddress, pairingLink } from '../login/pairing-link.ts';
import { useSignedOps } from '../signing/use-signed-ops.ts';
import { CopyText } from './copy-text.tsx';
import { Failure, useRead } from './system-read.tsx';
import { DevicePairLayer } from './device-pair-layer.tsx';
import { usePairingInvitation } from './use-pairing-invitation.ts';
import './device-pairing.css';

const QR_SIZE = 180;
const MINUTE_MS = 60_000;

function MacPairing(): ReactNode {
  const live = useLive();
  const { deviceUi, signedOps } = useClientState();
  const ui = useStore(deviceUi.store);
  const ops = useSignedOps(NODE_CODE_KEY);
  const timeZone = useTimeZone();
  return <details className="device-pair-help">
    <summary>连接 Mac 执行节点</summary>
    <div className="device-pair-mac">
      <p>让 Mac App 执行电脑上的操作。在 Mac 菜单栏的「配对这台 Mac」输入专用码。</p>
      <button type="button" className="chip-button" disabled={ops.some((op) => op.status === 'running')}
        onClick={() => void live.deviceWrites.issueCode()}>生成 Mac 专用码</button>
      {ui.code === null ? null : <div className="device-pair-code" role="status">
        <span className="mono">{ui.code.code}</span><CopyText text={ui.code.code} label="复制 Mac 专用码" />
        <span className="text-meta">{formatClock(ui.code.expiresAt, false, timeZone)} 前有效</span>
      </div>}
      <OpLines ops={ops} onRetry={(key) => void live.deviceWrites.retry(key)}
        onDismiss={(key) => signedOps.dismiss(key)} />
    </div>
  </details>;
}

function CopyLink({ text }: { text: string }): ReactNode {
  const [copied, setCopied] = useState(false);
  const [failed, setFailed] = useState(false);
  const copy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setFailed(false);
    } catch {
      setFailed(true);
    }
  };
  return <>
    <button type="button" className="primary-button" onClick={() => void copy()}>
      <Icon name={copied ? 'check' : 'link'} size={16} />{copied ? '已复制配对链接' : '复制配对链接'}</button>
    {failed ? <div className="device-pair-copy-error" role="alert">
      <p>复制不了，请选中链接手动复制。</p><input className="field-input" readOnly value={text} aria-label="配对链接" />
    </div> : null}
  </>;
}

export function DevicePairingSheet({ onClose, onConnected }: { onClose: () => void; onConnected: () => void })
  : ReactNode {
  const api = useApi();
  const phone = usePhone();
  const invite = usePairingInvitation(onConnected);
  const network = useRead<NetworkStatus>((signal) => api.network.status(signal), [api]);
  const address = pairingAddress(window.location.origin, network.value);
  const current = invite.status;
  const completed = current?.status === 'connected' ? current.device : null;
  const expired = current?.status === 'expired' || (invite.invitation !== null && invite.remaining === 0);
  const revoked = current?.status === 'revoked';
  const link = invite.invitation !== null && address.url !== null ? pairingLink(address.url, invite.invitation) : null;
  return <DevicePairLayer phone={phone}><Sheet open modal variant={phone ? 'drawer' : 'panel'}
    title="添加设备" onClose={onClose}
    className="device-pair-sheet">
    {completed != null ? <div className="device-pair-result" role="status">
      <span className="device-pair-success"><Icon name="check" size={40} /></span><h3>新设备已连接</h3>
      <div className="device-pair-connected"><Icon name="device" size={24} />
        <span>{completed.name}</span><StatusGlyph status="done" label="已连接" /></div>
      <button type="button" className="primary-button" onClick={onClose}>完成</button>
    </div> : expired || revoked ? <div className="device-pair-result">
      <Icon name="clock" size={40} /><h3>{revoked ? '这台新设备已撤销' : '配对邀请已过期'}</h3>
      <button type="button" className="primary-button" disabled={invite.busy}
        onClick={() => void invite.regenerate()}>{invite.busy ? '正在生成…' : '重新生成'}</button>
      {invite.error === null ? null : <p className="is-error" role="alert">{invite.error}</p>}
    </div> : <>
      <div className="device-pair-content">
        <h3>添加手机或浏览器</h3>
        {invite.busy && invite.invitation === null ? <p className="device-pair-wait" role="status">
          <StatusGlyph status="run" label="正在生成邀请" />正在生成配对邀请…</p> : null}
        {invite.invitation === null ? null : <div className="device-pair-hero">
          {link === null ? <div className="device-pair-address">
            <Icon name="phone" size={40} /><p>{network.error ?? address.problem}</p>
            <button type="button" className="text-button" onClick={network.reload}>重新读取地址</button>
          </div> : <><div className="device-pair-qr"><QrCode text={link} size={QR_SIZE} /></div><h4>用手机扫码</h4></>}
          <div className="device-pair-code"><span aria-label="备用配对码">{invite.invitation.code}</span>
            <CopyText text={invite.invitation.code} label="复制配对码" /></div>
          <p className="device-pair-expiry">{Math.max(1, Math.ceil(invite.remaining / MINUTE_MS))} 分钟后失效 · 仅用一次</p>
          {link === null ? null : <CopyLink key={invite.invitation.id} text={link} />}
        </div>}
        {invite.error === null ? null : <Failure error={invite.error}
          onReload={invite.invitation === null ? () => void invite.regenerate() : invite.reload} />}
        <details className="device-pair-help"><summary>另一台电脑怎么连接？</summary>
          <p>在另一台电脑的浏览器打开配对链接，再确认设备名称；也可以在登录页输入备用配对码。</p></details>
        <MacPairing />
      </div>
      {invite.invitation === null ? null : <footer className="device-pair-footer">
        <span className="device-pair-wait" role="status"><StatusGlyph status="run" label="等待新设备确认" />
          等待新设备确认</span>
        <button type="button" className="text-button text-button-quiet" disabled={invite.busy}
          onClick={() => void invite.regenerate()}>{invite.busy ? '正在生成…' : '重新生成'}</button>
      </footer>}
    </>}
  </Sheet></DevicePairLayer>;
}
