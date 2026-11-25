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
        if (context.hostType === 'html' && RELAY_PAGES.includes(context.hostId)) {
          return `/download/ui/${filename}`;
        }
        if (context.hostType === 'css' || context.hostType === 'js') return { relative: true };
        return undefined;
      },
    },
    server: {
      proxy: http ? { '/v2': { target: AGENT_ORIGIN } } : {},
    },
    test: {
      environment: 'jsdom',
      env: { TZ: 'Asia/Shanghai' },
      include: ['tests/**/*.test.{ts,tsx}'],
      setupFiles: ['tests/setup.ts'],
      restoreMocks: true,
      css: { include: [/\.css\?raw$/] },
    },
  };
});
