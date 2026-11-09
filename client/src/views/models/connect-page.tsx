// 连接模型（11-08 设计稿 Connect-Model）：一家都没连上时（第一次打开，或者连着的都掉了）整窗只有居中一列——
// 首次使用流程里是第 2 步的进度条，别的时候是 Plasticine 标记；「连上一个模型」+ 一句 + 平级的提供商列表。
// 点「登录」：那一行行尾变成「在浏览器里登录…」，授权完自动连上（use-provider-login.ts）；要贴回调地址的情形
// （普通网页连远程实例）在列表下面多一栏。点「填 key」换成填 key 那一步；连上了是「已连接」+「开始用」。
// 读不到连接状态时不挡（照常进），各处自己报错。

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import type { ModelProviderView } from '../../api/shared.ts';
import { useLive } from '../../live.tsx';
import { IconButton } from '../../shell/icon-button.tsx';
import { PlasticineMark } from '../../shell/plasticine-mark.tsx';
import { TooltipLayer } from '../../shell/tooltip.tsx';
import { useStore } from '../../state/use-store.ts';
import { Spinner } from '../lines/line-parts.tsx';
import { useFirstRun } from '../onboard/first-run.ts';
import { Stepper } from '../onboard/onboard-parts.tsx';
import { CallbackForm, Connected, KeyForm, PasteFallback, pasteFirst } from './provider-connect.tsx';
import { ProviderList, type ProviderAction } from './provider-list.tsx';
import { useProviderLogin } from './use-provider-login.ts';
import './models.css';

type Step = { kind: 'choose' } | { kind: 'login' | 'key' | 'done'; provider: ModelProviderView };

/**
 * 一家在浏览器里登录：跑登录那一套，列表下面要贴回调时多一栏、出错一行。列表本身不在这里（换来换去会整块重挂），
 * 那一行行尾的「取消」经 cancelRef 调到这里。
 */
function LoginWatcher({ provider, onDone, onCancel, cancelRef }: { provider: ModelProviderView; onDone: () => void;
  onCancel: () => void; cancelRef: { current: (() => void) | null } }): ReactNode {
  const flow = useProviderLogin(provider, onDone, onCancel);
  useEffect(() => {
    cancelRef.current = flow.cancel;
  });
  useEffect(() => () => {
    cancelRef.current = null;
  }, [cancelRef]);
  return (
    <>
      {pasteFirst(flow) ? <CallbackForm flow={flow} /> : <PasteFallback flow={flow} copy />}
      {flow.error === null ? null : <p className="ob-error" role="alert">{flow.error}</p>}
    </>
  );
}

export function ConnectPage({ onReady }: { onReady: () => void }): ReactNode {
  const live = useLive();
  const data = useStore(live.models.store);
  const firstRun = useFirstRun();
  const [step, setStep] = useState<Step>({ kind: 'choose' });
  const providers = data.value?.providers ?? [];
  const pick = (provider: ModelProviderView, action: ProviderAction): void => {
    if (action === 'logout') {
      void live.models.logout(provider.id);
      return;
    }
    setStep({ kind: action, provider });
  };
  const loggingIn = step.kind === 'login' ? step.provider : null;
  const done = useCallback(() => {
    if (loggingIn !== null) setStep({ kind: 'done', provider: loggingIn });
  }, [loggingIn]);
  const back = useCallback(() => setStep({ kind: 'choose' }), []);
  const cancelRef = useRef<(() => void) | null>(null);
  const pending = loggingIn === null ? null : { id: loggingIn.id, node: (
    <span className="ob-row-wait" role="status">
      <Spinner size={12} label="等授权" />在浏览器里登录…
      <IconButton icon="close" label="取消登录" size={14} onClick={() => {
        if (cancelRef.current === null) back();
        else cancelRef.current();
      }} />
    </span>
  ) };
  return (
    <main className="ob-page" aria-label="连接模型">
      <div className="ob-col">
        {step.kind === 'choose' || step.kind === 'login' ? (
          <>
            {firstRun ? <Stepper at={2} /> : <PlasticineMark size={28} />}
            <h1 className="ob-title">连上一个模型</h1>
            <p className="ob-sub">用你已有的订阅登录，或者填 key。</p>
            <ProviderList providers={providers} onAction={pick} compact pending={pending} />
            {loggingIn === null ? null : <LoginWatcher key={loggingIn.id} provider={loggingIn} onDone={done}
              onCancel={back} cancelRef={cancelRef} />}
          </>
        ) : null}
        {step.kind === 'key' ? <KeyForm provider={step.provider} onDone={() => setStep({ kind: 'done',
          provider: step.provider })} onBack={back} /> : null}
        {step.kind === 'done' ? <Connected provider={step.provider} onStart={onReady} onAnother={back}
          startLabel={firstRun ? '下一步' : '开始用'} /> : null}
      </div>
      <TooltipLayer />
    </main>
  );
}

/** 一家都没连上时先连模型；连上了（或读不到连接状态）照常进。连上之后点「开始用」才进，免得一闪就跳走。 */
export function ConnectGate({ children }: { children: ReactNode }): ReactNode {
  const live = useLive();
  const data = useStore(live.models.store);
  const firstRun = useFirstRun();
  const [connecting, setConnecting] = useState(false);
  useEffect(() => {
    void live.models.reload();
  }, [live.models]);
  const value = data.value;
  const nothing = value !== null && value.providers.length > 0 && value.effective === null;
  useEffect(() => {
    if (nothing) {
      setConnecting(true);
    }
  }, [nothing]);
  // 读到「一家都没连」的那一次渲染就给连接页（不等 effect），免得后面的门先挂上一下。
  if (connecting || nothing) {
    return <ConnectPage onReady={() => setConnecting(false)} />;
  }
  // 第一次的流程里，没读完连接状态前不先放后面的第 3 步出来（不然第 2 步还没出就跳过去了）。
  if (firstRun && !data.loaded && data.error === null) {
    return <main className="ob-page" aria-busy="true" />;
  }
  return children;
}
