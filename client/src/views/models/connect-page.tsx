// 连接模型（2026-11-05 设计稿 Connect）：第一次打开、或者连着的都掉了（重新登录）时，整个窗口只有居中一张卡——
// Plasticine 标记 +「连接模型」+ 平级的提供商列表；点「登录」换成在浏览器里授权那一步，点「填 key」换成填 key 那一步；
// 连上了是「已连接」+「开始用」。读不到连接状态时不挡（照常进），各处自己报错。

import { useEffect, useState, type ReactNode } from 'react';
import type { ModelProviderView } from '../../api/shared.ts';
import { useLive } from '../../live.tsx';
import { PlasticineMark } from '../../shell/plasticine-mark.tsx';
import { useStore } from '../../state/use-store.ts';
import { Stepper } from './onboard-gate.tsx';
import { Connected, KeyForm, LoginFlow } from './provider-connect.tsx';
import { ProviderList, type ProviderAction } from './provider-list.tsx';
import './models.css';

type Step = { kind: 'choose' } | { kind: 'login' | 'key' | 'done'; provider: ModelProviderView };

export function ConnectPage({ onReady }: { onReady: () => void }): ReactNode {
  const live = useLive();
  const data = useStore(live.models.store);
  const network = useStore(live.network.status.data);
  const [step, setStep] = useState<Step>({ kind: 'choose' });
  // 新装的实例（还没加入网络）：这是第一次打开三步里的第一步，顶上一条进度。
  const fresh = network.value?.welcome === true;
  useEffect(() => {
    live.network.status.open();
  }, [live.network]);
  const providers = data.value?.providers ?? [];
  const pick = (provider: ModelProviderView, action: ProviderAction): void => {
    if (action === 'logout') {
      void live.models.logout(provider.id);
      return;
    }
    setStep({ kind: action, provider });
  };
  const done = (provider: ModelProviderView) => () => setStep({ kind: 'done', provider });
  return (
    <main className="connect-page" aria-label="连接模型">
      <div className="connect-card">
        {step.kind === 'choose' ? (
          <>
            {fresh ? <Stepper at={1} /> : <PlasticineMark size={32} />}
            <h1 className="connect-title">连接模型</h1>
            <ProviderList providers={providers} onAction={pick} compact />
          </>
        ) : null}
        {step.kind === 'login' ? <LoginFlow provider={step.provider} onDone={done(step.provider)}
          onCancel={() => setStep({ kind: 'choose' })} /> : null}
        {step.kind === 'key' ? <KeyForm provider={step.provider} onDone={done(step.provider)}
          onBack={() => setStep({ kind: 'choose' })} /> : null}
        {step.kind === 'done' ? <Connected provider={step.provider} onStart={onReady}
          onAnother={() => setStep({ kind: 'choose' })} /> : null}
      </div>
    </main>
  );
}

/** 一家都没连上时先连模型；连上了（或读不到连接状态）照常进。连上之后点「开始用」才进，免得一闪就跳走。 */
export function ConnectGate({ children }: { children: ReactNode }): ReactNode {
  const live = useLive();
  const data = useStore(live.models.store);
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
  if (connecting) {
    return <ConnectPage onReady={() => setConnecting(false)} />;
  }
  return children;
}
