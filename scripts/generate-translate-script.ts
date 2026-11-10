// 沉浸式翻译注入网页标签的脚本只写一份（client/src/mac/translate-page*.ts，TypeScript，Vitest 在 jsdom 里测），
// 原生层要的是一段 JS。这里去掉类型（node:module 的 stripTypeScriptTypes，只能用可擦除的写法）、抹掉几份之间的
// import / export，拼成一段立即执行的脚本，写进 Mac 的 mac/Sources/Plasticine/translate-page-script.swift（iPhone 那一份
// 随 ios/ 2026-11-05 删掉）。`--check` 只核对生成的文件是不是最新（npm run lint 跑它）。

import { readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { fileURLToPath } from 'node:url';

const SOURCES = ['extract-page.ts', 'translate-page-rules.ts', 'translate-page-look.ts',
  'translate-page.ts', 'translate-page-host.ts']
  .map((name) => new URL(`../client/src/mac/${name}`, import.meta.url));

/** 生成到哪、第二行注释写给谁用、要不要 public（包里的才要 public，App 从包外用）。 */
export interface ScriptTarget {
  url: URL;
  about: string;
  access: '' | 'public ';
}

export const TARGETS: readonly ScriptTarget[] = [
  { url: new URL('../mac/Sources/Plasticine/translate-page-script.swift', import.meta.url),
    about: '// 沉浸式翻译注入网页标签的脚本（Mac 0.4.0，第 2 批），由 web-translate.swift 装进网页标签的独立脚本世界。',
    access: '' },
];

/** 一份 TypeScript → 能拼起来的 JS：去类型、去 import、export 的声明留下声明本身。 */
function plain(source: string): string {
  const stripped = stripTypeScriptTypes(source, { mode: 'strip' });
  return stripped
    .replace(/^import\s[\s\S]*?\sfrom\s+'[^']+';[ \t]*$/gm, '')
    .replace(/^export (?=(?:const|function|let|class|async) )/gm, '')
    .replace(/^export (?:type|interface) [\s\S]*?^}$/gm, '')
    .replace(/[ \t]+$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** 注入网页标签的整段脚本：同一个文档只装一次；消息走独立脚本世界里的 plasticineTranslatePage 通道。 */
export function translateScript(): string {
  const body = SOURCES.map((url) => plain(readFileSync(url, 'utf8'))).join('\n\n');
  return [
    '(() => {',
    'if (window.__plasticineTranslator) return;',
    body,
    'window.__plasticineExtract = (command) => extractPage(document, command);',
    'window.__plasticineTranslator = installPageTranslator(browserHost((message) => {',
    '  window.webkit.messageHandlers.plasticineTranslatePage.postMessage(message);',
    '}));',
    '})();',
  ].join('\n');
}

export function swiftSource(target: ScriptTarget = TARGETS[0]!): string {
  const script = translateScript();
  if (script.includes('"""#')) {
    throw new Error('翻译脚本里出现了 """#，Swift 的原样字符串装不下');
  }
  return [
    '// 生成的文件，不要手改：改 client/src/mac/translate-page*.ts，再运行 node scripts/generate-translate-script.ts。',
    target.about,
    '',
    `${target.access}enum TranslatePageScript {`,
    `    ${target.access}static let source = #"""`,
    script,
    '"""#',
    '}',
    '',
  ].join('\n');
}

function readCurrent(url: URL): string {
  try {
    return readFileSync(url, 'utf8').replaceAll('\r\n', '\n');
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      return '';
    }
    throw error;
  }
}

export function generate(check: boolean): void {
  for (const target of TARGETS) {
    const next = swiftSource(target);
    const current = readCurrent(target.url);
    if (check && current !== next) {
      throw new Error(`翻译脚本已过期（${fileURLToPath(target.url)}）：请运行 node scripts/generate-translate-script.ts`);
    }
    if (!check && current !== next) {
      writeFileSync(target.url, next);
    }
  }
}

if (process.argv[1] !== undefined && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  generate(process.argv.includes('--check'));
}
