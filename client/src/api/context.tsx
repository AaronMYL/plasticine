// 组件经 useApi() 拿接口对象，不直接 fetch（structure.md「不许出现的」）；测试换成假实现只改这一处。

import { createContext, useContext, type ReactNode } from 'react';
import type { PlasticineApi } from './client.ts';

const ApiContext = createContext<PlasticineApi | null>(null);

export function ApiProvider({ api, children }: { api: PlasticineApi; children: ReactNode }): ReactNode {
  return <ApiContext.Provider value={api}>{children}</ApiContext.Provider>;
}

export function useApi(): PlasticineApi {
  const api = useContext(ApiContext);
  if (api === null) {
    throw new Error('useApi 必须在 ApiProvider 里面用');
  }
  return api;
}

/** 不一定在 ApiProvider 里的小部件（网站图标）用：没有接口时是 null。 */
export function useApiOrNull(): PlasticineApi | null {
  return useContext(ApiContext);
}
