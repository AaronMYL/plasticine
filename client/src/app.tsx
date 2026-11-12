// 应用的组装：接口对象、客户端状态、遥测、这台浏览器的系统通知从外面传进来（main.tsx 按环境选，测试各自造），
// 里面是登录门（没主人先建账号，否则 @账号 + 密码）→ 实时层（一条 SSE + 线、卡的数据）→ 壳；老实例没设密码时壳上弹一次。
// 11-12《首次使用解耦》：一家模型都没连也不挡整窗，连模型在主线的欢迎卡里、用到模型时再弹；第一次不出手机扫码。
// 经 @账号的网址打开时，登录以后挂上直连（api/direct/），接口请求能直连就不经中继。
// 离开页面的提醒挂在这一层，登录门之外：401 回到登录页时壳和实时层卸掉了，没完成的内容还在 state/ 里，提醒也还在。

import { useEffect, type ReactNode } from 'react';
import { applyAppearance } from './shell/appearance.ts';
import type { PlasticineApi } from './api/client.ts';
import { ApiProvider } from './api/context.tsx';
import { DirectLink } from './api/direct/direct-link.tsx';
import { PushDeviceContext, type PushDevice } from './api/push-device.ts';
import { LiveProvider } from './live.tsx';
import { SetPasswordPrompt } from './views/onboard/set-password-prompt.tsx';
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
              <DirectLink />
              <LiveProvider>
                <Shell />
                <SetPasswordPrompt />
              </LiveProvider>
            </SessionGate>
          </PushDeviceContext.Provider>
        </TelemetryContext.Provider>
      </ClientStateProvider>
    </ApiProvider>
  );
}
