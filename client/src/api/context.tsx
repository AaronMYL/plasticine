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

export function useApiOrNull(): PlasticineApi | null {
  return useContext(ApiContext);
}
