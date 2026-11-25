import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import type { PlasticineApi } from './api/client.ts';
import { FakePushDevice } from './api/fake/fake-push-device.ts';
import { accountSceneOf, seedAccountScene } from './api/fake/account-scenes.ts';
import { createFakeApi } from './api/fake/index.ts';
import { createHttpApi } from './api/http/index.ts';
import { createBrowserPushDevice, type PushDevice } from './api/push-device.ts';
import { apiMode } from './api/select-api.ts';
import { App } from './app.tsx';
import { installNativePointer } from './mac/native-pointer.ts';
import { preloadLazyViews } from './shell/lazy-view.ts';
import { createClientState } from './state/context.tsx';
import type { KeyValueStorage } from './state/outbox.ts';
import { memorySink, Telemetry, type TelemetryRecord } from './telemetry.ts';

const DEV_STREAM_STEP_MS = 60;
const PRELOAD_AFTER_MS = 1500;

function preloadWhenIdle(): void {
  const run = (): void => {
    preloadLazyViews().catch((cause: unknown) => console.warn('预先读入页面代码没成功，切页时再读：', cause));
  };
  setTimeout(() => {
    if (typeof window.requestIdleCallback === 'function') {
      window.requestIdleCallback(run, { timeout: PRELOAD_AFTER_MS });
    } else {
      run();
    }
  }, PRELOAD_AFTER_MS);
}

const root = document.getElementById('root');
if (root === null) {
  throw new Error('index.html 里没有 #root');
}

function wantsEmpty(): boolean {
  return new URLSearchParams(window.location.search).has('empty');
}

function chooseApi(): { api: PlasticineApi; pushDevice: PushDevice } {
  const env = { PROD: import.meta.env.PROD, VITE_PLASTICINE_API: import.meta.env.VITE_PLASTICINE_API };
  if (apiMode(env) === 'http') {
    return { api: createHttpApi(), pushDevice: createBrowserPushDevice() };
  }
  if (wantsEmpty()) {
    const empty = createFakeApi({ seed: false, streamStepMs: DEV_STREAM_STEP_MS });
    empty.control.session.signInForDevelopment('本地开发');
    return { api: empty.api, pushDevice: new FakePushDevice() };
  }
  const scene = accountSceneOf(window.location.search);
  if (scene !== null && scene !== 'setpw') {
    const fresh = createFakeApi({ seed: false, streamStepMs: DEV_STREAM_STEP_MS });
    seedAccountScene(fresh, scene);
    return { api: fresh.api, pushDevice: new FakePushDevice() };
  }
  const fake = createFakeApi({ seed: true, streamStepMs: DEV_STREAM_STEP_MS });
  if (scene === 'setpw') {
    fake.control.account.seedNoPassword();
  }
  return { api: fake.api, pushDevice: new FakePushDevice() };
}

function tabStorage(): KeyValueStorage | null {
  try {
    return window.sessionStorage;
  } catch (error) {
    console.warn('sessionStorage 不可用，待发记录只在内存里', error);
    return null;
  }
}

function noteCacheStorage(): KeyValueStorage | null {
  try { return window.localStorage; }
  catch (cause) {
    console.warn('本机笔记缓存不可用，已打开的笔记只在当前页面内缓存。', cause);
    return null;
  }
}

function startApp(container: HTMLElement): void {
  const telemetryRecords: TelemetryRecord[] = [];
  const state = createClientState({ storage: tabStorage(), noteCacheStorage: noteCacheStorage() });
  const { api, pushDevice } = chooseApi();
  installNativePointer();

  createRoot(container).render(
    <StrictMode>
      <App
        api={api}
        state={state}
        telemetry={new Telemetry(memorySink(telemetryRecords), true)}
        pushDevice={pushDevice}
      />
    </StrictMode>,
  );
  preloadWhenIdle();
}

startApp(root);
