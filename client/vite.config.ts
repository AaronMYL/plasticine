// Vite builds the client; the `test` block configures Vitest so both share one plugin list.
// The dev server proxies /v2 to the agent on its loopback port (agent/src/app/config.ts DEFAULT_PORT), so
// `VITE_PLASTICINE_API=http npm run dev` talks to a local server with same-origin cookies and SSE.

import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { loadEnv } from 'vite';
import { defineConfig } from 'vitest/config';
import { precompress } from './build-compress.ts';
import { clientManifest } from './build-manifest.ts';
import { buildVersion } from './build-version.ts';
import { apiMode } from './src/api/select-api.ts';

const AGENT_ORIGIN = 'http://127.0.0.1:8790';
const RELAY_PAGES = ['download.html', 'site.html', 'demo.html'];
const { buildId, builtAt } = buildVersion();

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, import.meta.dirname, 'VITE_');
  const http = apiMode({ PROD: false, VITE_PLASTICINE_API: env['VITE_PLASTICINE_API'] }) === 'http';
  return {
    plugins: [react(), clientManifest(buildId, builtAt), precompress()],
    define: { __PLASTICINE_BUILD_ID__: JSON.stringify(buildId),
      __PLASTICINE_BUILT_AT__: JSON.stringify(builtAt) },
    build: { rollupOptions: { input: { main: fileURLToPath(new URL('./index.html', import.meta.url)),
      download: fileURLToPath(new URL('./download.html', import.meta.url)),
      site: fileURLToPath(new URL('./site.html', import.meta.url)),
      demo: fileURLToPath(new URL('./demo.html', import.meta.url)) } } },
    experimental: {
      renderBuiltUrl(filename, context) {
        // 下载页、官网和官网里嵌的演示页由中继独立服务；共享 chunk 的相对 import、CSS 的相对字体仍在这个资源前缀下。
        if (context.hostType === 'html' && RELAY_PAGES.includes(context.hostId)) {
          return `/download/ui/${filename}`;
        }
        // 按需加载的页面预取样式时也用相对地址：演示页的资源在 /download/ui/assets/ 下，主应用在 /assets/ 下。
        if (context.hostType === 'css' || context.hostType === 'js') return { relative: true };
        return undefined;
      },
    },
    server: {
      // 假接口的截图从 public/v2 读取；只有显式选择真接口时才转发给本机 agent。
      proxy: http ? { '/v2': { target: AGENT_ORIGIN } } : {},
    },
    test: {
      environment: 'jsdom',
      // 测试统一用上海时区（项目规矩）：写在这里，不靠跑的人记得在命令前带 TZ。
      env: { TZ: 'Asia/Shanghai' },
      include: ['tests/**/*.test.{ts,tsx}'],
      setupFiles: ['tests/setup.ts'],
      restoreMocks: true,
      // 字体回归测试读取实际 CSS；只放行显式的 raw 导入，其余样式仍由测试默认处理。
      css: { include: [/\.css\?raw$/] },
    },
  };
});
