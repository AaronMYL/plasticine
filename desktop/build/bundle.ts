// 把壳打成 Electron 能直接跑的几份 JS（dist/）：主进程、界面 preload、网页标签 preload（sandbox 的 preload 只能是一个
// 文件）、两段注入脚本（X 时间线、抖音）、开始页（静态页、脚本、字体），再拷图标。注入网页标签的脚本只写一份：client/src/mac/ 里的那几份
// 原样打进来（圈一块、问这一页那两段字符串在这里包成函数），Mac 的 Swift 壳和 Electron 壳共用。
//   node desktop/build/bundle.ts            打一次
//   node desktop/build/bundle.ts --check     只核对能打（lint 不跑它，CI 的构建跑）

import { copyFileSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build, type Plugin } from 'esbuild';

const DESKTOP = fileURLToPath(new URL('..', import.meta.url));
const ROOT = join(DESKTOP, '..');
const DIST = join(DESKTOP, 'dist');
const MAC_SCRIPTS = join(ROOT, 'client', 'src', 'mac');

/** 圈一块、问这一页的脚本是给 callAsyncJavaScript 用的函数体（带 return await）：包成 async 函数。 */
async function pageScriptsModule(): Promise<string> {
  const circle = await import(pathToFileURL(join(MAC_SCRIPTS, 'circle-page.ts')).href) as
    { CIRCLE_PAGE_SCRIPT: string };
  const operate = await import(pathToFileURL(join(MAC_SCRIPTS, 'page-operate.ts')).href) as
    { PAGE_OPERATE_SCRIPT: string };
  return [
    `export async function circlePage() {\n${circle.CIRCLE_PAGE_SCRIPT}\n}`,
    `export async function pageOperate(request) {\n${operate.PAGE_OPERATE_SCRIPT}\n}`,
  ].join('\n');
}

const pageScripts: Plugin = {
  name: 'plasticine-page-scripts',
  setup(context) {
    context.onResolve({ filter: /^plasticine:page-scripts$/ },
      () => ({ path: 'page-scripts', namespace: 'plasticine' }));
    context.onLoad({ filter: /.*/, namespace: 'plasticine' }, async () => ({ contents: await pageScriptsModule(),
      loader: 'js', resolveDir: MAC_SCRIPTS }));
  },
};

function injected(file: string, install: string, global: string): string {
  return `import { ${install} } from ${JSON.stringify(join(MAC_SCRIPTS, file))};\n`
    + `if (!window.${global}) { window.${global} = ${install}(window); }\n`;
}

export async function bundle(): Promise<void> {
  rmSync(DIST, { recursive: true, force: true });
  mkdirSync(join(DIST, 'pages'), { recursive: true });
  const common = { bundle: true, logLevel: 'warning' as const, legalComments: 'none' as const, charset: 'utf8' as const,
    sourcemap: 'linked' as const };
  await build({ ...common, entryPoints: [join(DESKTOP, 'src', 'app', 'main.ts')], outfile: join(DIST, 'main.cjs'),
    platform: 'node', format: 'cjs', target: 'node24', external: ['electron'] });
  await build({ ...common, entryPoints: [join(DESKTOP, 'src', 'app', 'ui-preload.ts')],
    outfile: join(DIST, 'preload-ui.cjs'), platform: 'browser', format: 'cjs', target: 'chrome140',
    external: ['electron'] });
  await build({ ...common, entryPoints: [join(DESKTOP, 'src', 'tabs', 'tab-preload.ts')],
    outfile: join(DIST, 'preload-tab.cjs'), platform: 'browser', format: 'cjs', target: 'chrome140',
    external: ['electron'], plugins: [pageScripts] });
  for (const [name, file, install, global] of [
    ['x-timeline', 'x-timeline-page.ts', 'installTimelineReader', '__plasticineX'],
    ['douyin', 'douyin-page.ts', 'installDouyinReader', '__plasticineDouyin'],
  ] as const) {
    await build({ ...common, sourcemap: false, stdin: { contents: injected(file, install, global),
      resolveDir: MAC_SCRIPTS, loader: 'ts' }, outfile: join(DIST, 'pages', `${name}.js`), platform: 'browser',
    format: 'iife', target: 'chrome140' });
  }
  // 开始页：静态页 + 打成一份的脚本（和主进程共用 @账号 / 地址的解析），字体用界面同一份 Geist（只打英文字体）。
  copyFileSync(join(DESKTOP, 'src', 'pages', 'start.html'), join(DIST, 'start.html'));
  await build({ ...common, sourcemap: false, entryPoints: [join(DESKTOP, 'src', 'pages', 'start.ts')],
    outfile: join(DIST, 'start.js'), platform: 'browser', format: 'iife', target: 'chrome140' });
  mkdirSync(join(DIST, 'fonts'), { recursive: true });
  copyFileSync(join(ROOT, 'client', 'src', 'fonts', 'Geist-Variable.woff2'),
    join(DIST, 'fonts', 'Geist-Variable.woff2'));
  mkdirSync(dirname(join(DIST, 'icon.png')), { recursive: true });
  copyFileSync(join(ROOT, 'client', 'public', 'icon-512.png'), join(DIST, 'icon.png'));
}

if (import.meta.main) {
  await bundle();
  console.log(`打好了：${DIST}`);
}
