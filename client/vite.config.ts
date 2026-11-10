// Vite builds the client; the `test` block configures Vitest so both share one plugin list.
// The dev server proxies /v2 to the agent on its loopback port (agent/src/app/config.ts DEFAULT_PORT), so
// `VITE_PLASTICINE_API=http npm run dev` talks to a local server with same-origin cookies and SSE.

import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { loadEnv } from 'vite';
import { defineConfig } from 'vitest/config';
import { clientManifest } from './build-manifest.ts';
import { buildVersion } from './build-version.ts';
import { apiMode } from './src/api/select-api.ts';

const AGENT_ORIGIN = 'http://127.0.0.1:8790';
const { buildId, builtAt } = buildVersion();

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, import.meta.dirname, 'VITE_');
  const http = apiMode({ PROD: false, VITE_PLASTICINE_API: env['VITE_PLASTICINE_API'] }) === 'http';
  return {
    plugins: [react(), clientManifest(buildId, builtAt)],
    define: { __PLASTICINE_BUILD_ID__: JSON.stringify(buildId),
      __PLASTICINE_BUILT_AT__: JSON.stringify(builtAt) },
    build: { rollupOptions: { input: { main: fileURLToPath(new URL('./index.html', import.meta.url)),
      download: fileURLToPath(new URL('./download.html', import.meta.url)),
      site: fileURLToPath(new URL('./site.html', import.meta.url)) } } },
    experimental: {
      renderBuiltUrl(filename, context) {
        // 下载页和官网由中继独立服务；共享 chunk 的相对 import、CSS 的相对字体仍在这个资源前缀下。
        if (context.hostType === 'html' && (context.hostId === 'download.html' || context.hostId === 'site.html')) {
          return `/download/ui/${filename}`;
        }
        if (context.hostType === 'css') return { relative: true };
        return undefined;
      },
    },
    server: {
      // 假接口的截图从 public/v2 读取；只有显式选择真接口时才转发给本机 agent。
      proxy: http ? { '/v2': { target: AGENT_ORIGIN } } : {},
    },
    test: {
      environment: 'jsdom',
      include: ['src/**/*.test.{ts,tsx}', 'tests/**/*.test.{ts,tsx}'],
      setupFiles: ['tests/setup.ts'],
      restoreMocks: true,
      // 字体回归测试读取实际 CSS；只放行显式的 raw 导入，其余样式仍由测试默认处理。
      css: { include: [/\.css\?raw$/] },
    },
  };
});
