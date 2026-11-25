export type ApiMode = 'http' | 'fake';

export interface ApiEnv {
  PROD: boolean;
  VITE_PLASTICINE_API?: string | undefined;
}

export function apiMode(env: ApiEnv): ApiMode {
  if (env.VITE_PLASTICINE_API === 'http') {
    return 'http';
  }
  if (env.VITE_PLASTICINE_API === 'fake') {
    return 'fake';
  }
  if (env.VITE_PLASTICINE_API !== undefined && env.VITE_PLASTICINE_API !== '') {
    throw new Error(`VITE_PLASTICINE_API 只能是 http 或 fake，现在是「${env.VITE_PLASTICINE_API}」`);
  }
  return env.PROD ? 'http' : 'fake';
}
