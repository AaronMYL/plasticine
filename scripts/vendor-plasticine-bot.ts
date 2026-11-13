// 队友头像用的角色引擎（11-13 Aaron 定「放打包好的引擎」）：从 Plasticine-bot 的检出里打一个压缩过的 ES 模块，放进
// client/src/vendor/plasticine-bot/。只导出界面用到的几样，摇树后剩下的才进包；文件头写来源提交和 MIT 许可。
// 用法：node scripts/vendor-plasticine-bot.ts <Plasticine-bot 检出目录>
//   检出里要先装好依赖、构建过引擎：pnpm install --frozen-lockfile && pnpm --filter @plasticine-bot/engine build

import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
export const VENDOR_DIR = join(ROOT, 'client/src/vendor/plasticine-bot');

/** 界面用到的引擎导出；加一项要同时在 engine.d.ts 里写上类型。 */
export const ENGINE_EXPORTS = [
  'createCharacter',
  'renderStaticSvg',
  'defineShape',
  'defineFace',
  'FACE_KIT',
  'STATE_CUTE_EYES',
  'STATE_CUTE_MOUTH',
  'CUTE_MOUTHS',
  'SHAPE_IDS',
  'SHAPE_FAMILIES',
] as const;

export function entrySource(distIndex: string): string {
  return `export { ${ENGINE_EXPORTS.join(', ')} } from ${JSON.stringify(distIndex)};\n`;
}

/** 节日主题是按需加载的分包，Plasticine 用不到：换成直接失败，不留分包。 */
export function dropThemeImports(code: string): string {
  return code.replace(/import\(\s*["']@plasticine-bot\/engine\/themes\/[a-z-]+["']\s*\)/g,
    'Promise.reject(new Error("Plasticine-bot themes are not bundled"))');
}

export function banner(commit: string): string {
  return `/*! Plasticine-bot engine ${commit} (MIT, see ./LICENSE), bundled by scripts/vendor-plasticine-bot.ts */\n`;
}

async function main(): Promise<void> {
  const checkout = process.argv[2];
  if (checkout === undefined) {
    throw new Error('用法：node scripts/vendor-plasticine-bot.ts <Plasticine-bot 检出目录>');
  }
  const repo = resolve(checkout);
  const distIndex = join(repo, 'packages/engine/dist/index.js');
  if (!existsSync(distIndex)) {
    throw new Error('检出里没有构建好的引擎：先 pnpm --filter @plasticine-bot/engine build');
  }
  const commit = execFileSync('git', ['-C', repo, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  const work = mkdtempSync(join(tmpdir(), 'plasticine-bot-'));
  try {
    const entry = join(work, 'entry.js');
    writeFileSync(entry, entrySource(distIndex));
    const { build } = await import('vite');
    await build({
      configFile: false,
      logLevel: 'warn',
      root: work,
      plugins: [{ name: 'plasticine-bot-no-themes', transform: (code: string, id: string) =>
        (id === distIndex ? dropThemeImports(code) : null) }],
      build: {
        outDir: join(work, 'out'),
        emptyOutDir: true,
        minify: true,
        lib: { entry, formats: ['es'], fileName: () => 'engine.js' },
        // 库模式的 es 格式默认不压空白（为了留给下游摇树）；这个文件就是最终产物，整份压。
        rolldownOptions: { output: { minify: true, comments: false } },
      },
    });
    const code = readFileSync(join(work, 'out/engine.js'), 'utf8');
    if (/\bimport\(/.test(code)) {
      throw new Error('打包结果里还有按需加载的分包，放不进一个文件');
    }
    writeFileSync(join(VENDOR_DIR, 'engine.js'), banner(commit) + code);
    copyFileSync(join(repo, 'LICENSE'), join(VENDOR_DIR, 'LICENSE'));
    const size = Math.round(code.length / 1024);
    console.log(`client/src/vendor/plasticine-bot/engine.js：${commit.slice(0, 7)}，${size} KB`);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
