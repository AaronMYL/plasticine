// The classic worker cannot import TypeScript. Compile the shared schema into its checked-in validator at build time.
import { readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Code } from 'typebox/compile';
import { PushPayloadSchema } from '../agent/shared/api/push.ts';

const START = '// BEGIN generated PushPayloadSchema';
const END = '// END generated PushPayloadSchema';
const path = new URL('../client/public/sw.js', import.meta.url);

export function pushValidator(): string {
  const generated = Code(PushPayloadSchema);
  const external = generated.External.variables.map((value) => {
    if (!(value instanceof RegExp)) {
      throw new Error('推送 schema 的外部校验需先支持独立 worker 构建');
    }
    return value.toString();
  });
  const body = generated.Code.replace(/^import .*\r?\n/gm, '').replace(/^export /gm, '')
    .replaceAll(' && ', ' &&\n    ');
  if (/\b(?:Hashing|Guard)\b/.test(body)) {
    throw new Error('推送 schema 引入了需打包的校验依赖');
  }
  return `const isPushPayload = (() => {\n${body}\nSetExternal({ variables: [${external.join(', ')}] });\n`
    + 'return Check;\n})();';
}

export function generate(check: boolean): void {
  const source = readFileSync(path, 'utf8').replaceAll('\r\n', '\n');
  const start = source.indexOf(START);
  const end = source.indexOf(END, start);
  if (start < 0 || end < 0) {
    throw new Error('sw.js 缺少生成区标记');
  }
  const next = source.slice(0, start) + `${START}\n${pushValidator()}\n${END}` + source.slice(end + END.length);
  if (check && next !== source) {
    throw new Error('推送校验已过期：请运行 node scripts/generate-sw-payload.ts');
  }
  if (!check && next !== source) {
    writeFileSync(path, next);
  }
}

if (process.argv[1] !== undefined && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  generate(process.argv.includes('--check'));
}
