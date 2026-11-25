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
import './shell/cards.css';

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
