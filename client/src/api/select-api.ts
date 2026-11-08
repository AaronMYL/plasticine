// 用哪一套接口：生产构建默认连真服务端；`npm run dev` 和测试默认用内存假实现，
// VITE_PLASTICINE_API=http 时 dev 也连真接口（vite 把 /v2 反代到 127.0.0.1:8790），=fake 时构建也用假的。

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
