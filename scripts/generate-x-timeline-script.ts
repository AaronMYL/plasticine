// 读 X「关注」时间线的注入脚本只写一份（client/src/mac/x-timeline-page.ts，TypeScript，Vitest 在 jsdom 里测），
// Mac 原生层要的是一段 JS。和 generate-translate-script.ts 同一个做法：去掉类型、抹掉 import / export，包成一段立即执行的
// 脚本，把读取器装到 window.__plasticineXTimeline 上，写进 mac/Sources/Plasticine/x-timeline-script.swift。
// `--check` 只核对生成的文件是不是最新（scripts/generate-x-timeline-script.test.ts 在全测里跑它）。

import { readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { fileURLToPath } from 'node:url';

const SOURCE = new URL('../client/src/mac/x-timeline-page.ts', import.meta.url);
export const TARGET = new URL('../mac/Sources/Plasticine/x-timeline-script.swift', import.meta.url);

function plain(source: string): string {
  return stripTypeScriptTypes(source, { mode: 'strip' })
    .replace(/^import\s[\s\S]*?\sfrom\s+'[^']+';[ \t]*$/gm, '')
    .replace(/^export (?=(?:const|function|let|class|async) )/gm, '')
    .replace(/^export (?:type|interface) [\s\S]*?^}$/gm, '')
    .replace(/^export type [^\n]*;$/gm, '')
    .replace(/[ \t]+$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function timelineScript(): string {
  return [
    '(() => {',
    'if (window.__plasticineXTimeline) return;',
    plain(readFileSync(SOURCE, 'utf8')),
    'window.__plasticineXTimeline = installTimelineReader(window);',
    '})();',
  ].join('\n');
}

export function swiftSource(): string {
  const script = timelineScript();
  if (script.includes('"""#')) {
    throw new Error('X 时间线脚本里出现了 """#，Swift 的原样字符串装不下');
  }
  return [
    '// 生成的文件，不要手改：改 client/src/mac/x-timeline-page.ts，再运行 node scripts/generate-x-timeline-script.ts。',
    '// 读 X「关注」时间线的注入脚本（第 3 批信息流），由 x-timeline-reader.swift 装进看不见的网页视图的独立脚本世界。',
    '',
    'enum XTimelineScript {',
    '    static let source = #"""',
    script,
    '"""#',
    '}',
    '',
  ].join('\n');
}

function readCurrent(): string {
  try {
    return readFileSync(TARGET, 'utf8').replaceAll('\r\n', '\n');
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      return '';
    }
    throw error;
  }
}

export function generate(check: boolean): void {
  const next = swiftSource();
  const current = readCurrent();
  if (check && current !== next) {
    throw new Error(`X 时间线脚本已过期（${fileURLToPath(TARGET)}）：请运行 node scripts/generate-x-timeline-script.ts`);
  }
  if (!check && current !== next) {
    writeFileSync(TARGET, next);
  }
}

if (process.argv[1] !== undefined && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  generate(process.argv.includes('--check'));
}
