// 什么时候查新版本（2026-11-12《首次使用解耦》）。原来每分钟查一次、窗口在后台也查，一个开着的窗口一天约 1.2 GB。
// 现在：打开时查一次（由调用方做）；服务重启（事件流 resync）或发布记录变了（client.versionChanged）马上查；
// 窗口切回前台、离上次超过 5 分钟再查；前台开着时每 30 分钟兜底查一次，后台不查。

export const VERSION_SAFETY_MS = 30 * 60_000;
export const VERSION_STALE_MS = 5 * 60_000;

export interface VersionCheckDeps {
  check: () => void;
  /** 订阅事件流，回调收到事件类型；返回退订。 */
  onLiveEvent: (listener: (type: string) => void) => () => void;
  visible: () => boolean;
  onVisibilityChange: (listener: () => void) => () => void;
  now: () => number;
}

/** 挂上之后的查法（不含打开时那一次）；返回停掉。 */
export function scheduleVersionChecks(deps: VersionCheckDeps): () => void {
  let last = deps.now();
  const run = (): void => {
    last = deps.now();
    deps.check();
  };
  const stopLive = deps.onLiveEvent((type) => {
    if (type === 'resync' || type === 'client.versionChanged') {
      run();
    }
  });
  const stopVisible = deps.onVisibilityChange(() => {
    if (deps.visible() && deps.now() - last >= VERSION_STALE_MS) {
      run();
    }
  });
  const timer = setInterval(() => {
    if (deps.visible()) {
      run();
    }
  }, VERSION_SAFETY_MS);
  return () => {
    stopLive();
    stopVisible();
    clearInterval(timer);
  };
}

/** 浏览器里的可见性：document 不在（测试、服务端渲染）时当作一直在前台。 */
export function documentVisibility(): Pick<VersionCheckDeps, 'visible' | 'onVisibilityChange'> {
  if (typeof document === 'undefined') {
    return { visible: () => true, onVisibilityChange: () => () => undefined };
  }
  return {
    visible: () => document.visibilityState !== 'hidden',
    onVisibilityChange: (listener) => {
      document.addEventListener('visibilitychange', listener);
      return () => document.removeEventListener('visibilitychange', listener);
    },
  };
}
