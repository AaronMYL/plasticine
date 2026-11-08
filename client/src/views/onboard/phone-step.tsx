// 在手机上也能用（11-08 设计稿 Phone-Step，首次使用流程第 3 步，可跳过）：二维码指向 https://<账号>.cyberhunter.top/#/login，
// 下面地址和「手机扫码，输入密码」，主按钮「进入 Plasticine」。没加入网络（没有 networkUrl）就跳过这一步。
// 走完（或跳过）擦掉「在第一次的流程里」，落在主线（Plasticine 在那里先打招呼）。

import { useEffect, useState, type ReactNode } from 'react';
import { useApi } from '../../api/context.tsx';
import { QrCode } from '../contacts/qr-code.tsx';
import { finishFirstRun, useFirstRun } from './first-run.ts';
import { Stepper } from './onboard-parts.tsx';
import { MAIN_LINE_HASH } from './setup-view.tsx';

const QR_SIZE = 150;

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch (cause) {
    console.warn('手机网址解不开，照原样显示', cause);
    return url;
  }
}

/** 第一次的流程走完：落在主线。 */
function finish(): void {
  window.history.replaceState(window.history.state, '', `${window.location.pathname}${MAIN_LINE_HASH}`);
  window.dispatchEvent(new HashChangeEvent('hashchange'));
  finishFirstRun();
}

export function PhoneStep({ url, onDone }: { url: string; onDone: () => void }): ReactNode {
  const host = hostOf(url);
  return (
    <main className="ob-page" aria-label="在手机上也能用">
      <div className="ob-col">
        <Stepper at={3} />
        <h1 className="ob-title">在手机上也能用</h1>
        <div className="ob-qr-block">
          <div className="ob-qr"><QrCode text={`${url.replace(/\/$/, '')}/#/login`} size={QR_SIZE} /></div>
          <div className="ob-address">{host}</div>
          <p className="ob-note">手机扫码，输入密码</p>
        </div>
        <button type="button" className="primary-button ob-big" onClick={onDone}>进入 Plasticine</button>
      </div>
    </main>
  );
}

/** 建完账号、连上模型以后：有手机网址就给第 3 步，没有就直接进主线。 */
export function PhoneStepGate({ children }: { children: ReactNode }): ReactNode {
  const api = useApi();
  const firstRun = useFirstRun();
  const [url, setUrl] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    if (!firstRun) return undefined;
    const controller = new AbortController();
    api.account.state(controller.signal).then((state) => {
      if (controller.signal.aborted) return;
      if (state.networkUrl === null) finish();
      else setUrl(state.networkUrl);
    }, (cause: unknown) => {
      if (controller.signal.aborted) return;
      console.warn('没读到手机网址，跳过「在手机上也能用」', cause);
      finish();
    });
    return () => controller.abort();
  }, [api, firstRun]);
  if (!firstRun) {
    return children;
  }
  if (url === undefined || url === null) {
    return <main className="ob-page" aria-busy="true" />;
  }
  return <PhoneStep url={url} onDone={finish} />;
}
