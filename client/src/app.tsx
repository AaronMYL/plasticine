// 应用的组装：接口对象、客户端状态、遥测、这台浏览器的系统通知从外面传进来（main.tsx 按环境选，测试各自造），
// 里面是配对门 → 实时层（一条 SSE + 线、卡的数据）→ 一家模型都没连时先连模型（connect-page.tsx）→ 三栏壳。离开页面的提醒挂在这一层，配对门之外：
// 401 回到配对页时壳和实时层卸掉了，没完成的内容还在 state/ 里，提醒也还在。

import { useEffect, type ReactNode } from 'react';
import { applyAppearance } from './shell/appearance.ts';
import type { PlasticineApi } from './api/client.ts';
import { ApiProvider } from './api/context.tsx';
import { PushDeviceContext, type PushDevice } from './api/push-device.ts';
import { LiveProvider } from './live.tsx';
import { ConnectGate } from './views/models/connect-page.tsx';
import { OnboardGate } from './views/models/onboard-gate.tsx';
import { SessionGate } from './shell/session-gate.tsx';
import { Shell } from './shell/shell.tsx';
import { useUnsavedGuard } from './shell/unsaved-guard.ts';
import { ClientStateProvider, type ClientState } from './state/context.tsx';
import { TelemetryContext, type Telemetry } from './telemetry.ts';
import './tokens.css';
import './shell/base.css';
import './shell/secondary-button.css';
import './shell/avatar.css';

export interface AppProps {
  api: PlasticineApi;
  state: ClientState;
  telemetry: Telemetry;
  pushDevice: PushDevice;
}

export function App({ api, state, telemetry, pushDevice }: AppProps): ReactNode {
  useUnsavedGuard(state);
  useEffect(() => { applyAppearance(); }, []);
  return (
    <ApiProvider api={api}>
      <ClientStateProvider state={state}>
        <TelemetryContext.Provider value={telemetry}>
          <PushDeviceContext.Provider value={pushDevice}>
            <SessionGate>
              <LiveProvider>
                <ConnectGate>
                  <OnboardGate>
                    <Shell />
                  </OnboardGate>
                </ConnectGate>
              </LiveProvider>
            </SessionGate>
          </PushDeviceContext.Provider>
        </TelemetryContext.Provider>
      </ClientStateProvider>
    </ApiProvider>
  );
}
