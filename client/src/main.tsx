// 入口：按构建环境选接口（api/select-api.ts），生产连 /v2/ 真服务端，本地开发默认用内存假实现。
// 系统通知跟着走：真接口用这台浏览器的 service worker 和 PushManager，假接口用假的（假公钥订不了真推送服务）。
// 2026-11-05 他定：网页是正式端（手机只用网页），不再拦「请用客户端」。

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

/** 本地开发时流式回复每段间隔 60ms，看得出一段段长出来。 */
const DEV_STREAM_STEP_MS = 60;
/** 首屏画完、浏览器空下来以后再把其余页面的代码读进来：第一次切过去也不闪「读取中」。 */
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
  // ?empty：什么都没有的样子（首页全空时只有问候一行这类截图用），只登进来、不放示例数据。
  if (wantsEmpty()) {
    const empty = createFakeApi({ seed: false, streamStepMs: DEV_STREAM_STEP_MS });
    empty.control.session.signInForDevelopment('本地开发');
    return { api: empty.api, pushDevice: new FakePushDevice() };
  }
  // ?account=：首次使用流程那几屏（建账号、登录、主线里连模型、连好以后、设密码），见 account-scenes.ts。
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

/** 待发记录存进这个标签页的 sessionStorage；浏览器禁用了就只在内存里（照样能核实重发，只是刷新会丢）。 */
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
  // Mac App 点在原生网页标签上时外层文档收不到 pointerdown：原生层另报一声，浮层听它收起。
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
