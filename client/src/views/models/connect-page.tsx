// 连接模型（11-08 设计稿 Connect-Model）：一家都没连上时（第一次打开，或者连着的都掉了）整窗只有居中一列——
// 首次使用流程里是第 2 步的进度条，别的时候是 Plasticine 标记；「连上一个模型」+ 一句 + 平级的提供商列表。
// 点「登录」：那一行行尾变成「在浏览器里登录…」，授权完自动连上（use-provider-login.ts）；要贴回调地址的情形
// （普通网页连远程实例）在列表下面多一栏。点「填 key」换成填 key 那一步；连上了是「已连接」+「开始用」。
// 读不到连接状态时不挡（照常进），各处自己报错。

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { DEFAULT_THINKING, type ModelProviderView } from '../../api/shared.ts';
import { useLive } from '../../live.tsx';
import { IconButton } from '../../shell/icon-button.tsx';
import { PlasticineMark } from '../../shell/plasticine-mark.tsx';
import { TooltipLayer } from '../../shell/tooltip.tsx';
import { WindowDragStrip } from '../../shell/window-drag-strip.tsx';
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

/** 连上以后还没有能用的默认模型（这家的模型一个都没启用）：先用这家的第一个，免得进去了也用不了。 */
async function ensureDefault(live: ReturnType<typeof useLive>, provider: ModelProviderView): Promise<void> {
  const value = live.models.store.get().value;
  const model = value?.providers.find((item) => item.id === provider.id)?.models[0] ?? provider.models[0];
  if (value === null || value.effective !== null || model === undefined) return;
  await live.models.choose({ provider: provider.id, model: model.id, thinking: DEFAULT_THINKING });
}

export function ConnectPage({ onReady, onClose }: { onReady: () => void; onClose?: (() => void) | undefined }):
  ReactNode {
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
            {onClose === undefined || loggingIn !== null ? null : (
              <button type="button" className="text-button text-button-quiet ob-later" onClick={onClose}>稍后再连</button>
            )}
          </>
        ) : null}
        {step.kind === 'key' ? <KeyForm provider={step.provider} onDone={() => setStep({ kind: 'done',
          provider: step.provider })} onBack={back} /> : null}
        {step.kind === 'done' ? <Connected provider={step.provider} onAnother={back} onStart={() => {
          void ensureDefault(live, step.provider).finally(onReady);
        }}
          startLabel={firstRun ? '下一步' : '开始用'} /> : null}
      </div>
      <TooltipLayer />
    </main>
  );
}

/**
 * 一家都没连上时先连模型；连上了（或读不到连接状态）照常进。连上之后点「开始用」才进，免得一闪就跳走。
 * 只看「有没有一家连着」，不看默认模型能不能用：连着却没启用模型，是设置 · AI 里的事，连接页解决不了，挡住就出不来了
 * （11-09 他在设置里添加提供商后被挡在这页，重启也出不来）。不是第一次用的时候，右上角能关掉先进去。
 */
export function ConnectGate({ children }: { children: ReactNode }): ReactNode {
  const live = useLive();
  const data = useStore(live.models.store);
  const firstRun = useFirstRun();
  const [connecting, setConnecting] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  useEffect(() => {
    void live.models.reload();
  }, [live.models]);
  const value = data.value;
  const nothing = value !== null && value.providers.length > 0
    && value.providers.every((provider) => provider.connected === null);
  useEffect(() => {
    if (nothing) {
      setConnecting(true);
    }
  }, [nothing]);
  // 读到「一家都没连」的那一次渲染就给连接页（不等 effect），免得后面的门先挂上一下。
  if (!dismissed && (connecting || nothing)) {
    const leave = firstRun ? undefined : () => {
      setDismissed(true);
      setConnecting(false);
    };
    return <><WindowDragStrip /><ConnectPage onReady={() => setConnecting(false)} onClose={leave} /></>;
  }
  // 第一次的流程里，没读完连接状态前不先放后面的第 3 步出来（不然第 2 步还没出就跳过去了）。
  if (firstRun && !data.loaded && data.error === null) {
    return <main className="ob-page" aria-busy="true" />;
  }
  return children;
}
