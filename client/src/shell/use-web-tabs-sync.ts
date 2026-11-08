// 壳挂上时让竖排标签和本体对上（state/web-tabs-sync.ts），卸下（回到配对页）时停。

import { useEffect } from 'react';
import { useApi } from '../api/context.tsx';
import { useLive } from '../live.tsx';
import { useClientState } from '../state/context.tsx';
import { WebTabsSync } from '../state/web-tabs-sync.ts';

export function useWebTabsSync(): void {
  const api = useApi();
  const live = useLive();
  const { webTabs } = useClientState();
  useEffect(() => {
    const sync = new WebTabsSync({ tabs: webTabs, api: api.webTabs, hub: live.hub });
    sync.start();
    return () => sync.stop();
  }, [api, live.hub, webTabs]);
}
