export const VERSION_SAFETY_MS = 30 * 60_000;
export const VERSION_STALE_MS = 5 * 60_000;

export interface VersionCheckDeps {
  check: () => void;
  onLiveEvent: (listener: (type: string) => void) => () => void;
  visible: () => boolean;
  onVisibilityChange: (listener: () => void) => () => void;
  now: () => number;
}

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
