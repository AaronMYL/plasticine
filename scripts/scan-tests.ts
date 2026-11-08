// 推送前机器扫测试文件（第 95 条）：测试内容不进审阅材料，这几样由脚本挡——
// 像真密钥的串（各家令牌的固定前缀、私钥块）和只跑一条的 `.only(`。命中就以非零退出。
// 用法：node scripts/scan-tests.ts

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOTS = ['agent/tests', 'client/tests', 'agent/src', 'client/src', 'scripts'];
const TEST_FILE = /\.test\.tsx?$/;

export const SECRET_SHAPES: ReadonlyArray<{ name: string; pattern: RegExp }> = [
  { name: 'OpenAI 类密钥', pattern: /\bsk-(?:proj-)?[A-Za-z0-9_-]{32,}/ },
  { name: 'GitHub 令牌', pattern: /\b(?:ghp|gho|ghu|ghs|ghr|github_pat)_[A-Za-z0-9_]{30,}/ },
  { name: 'AWS 访问密钥', pattern: /\bAKIA[0-9A-Z]{16}\b/ },
  { name: 'Google API 密钥', pattern: /\bAIza[0-9A-Za-z_-]{35}\b/ },
  { name: 'Slack 令牌', pattern: /\bxox[abpr]-[A-Za-z0-9-]{20,}/ },
  { name: '私钥块', pattern: /-----BEGIN (?:RSA |EC |OPENSSH |)PRIVATE KEY-----/ },
];
const ONLY_CALL = /\b(?:test|it|describe)(?:\s*\.\s*\w+)*\s*\.\s*only(?:\s*\.\s*\w+)*\s*\(/g;

function walk(directory: string, found: string[]): void {
  let entries: string[];
  try {
    entries = readdirSync(directory);
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      return; // 只有服务端的分支可能没有客户端目录。
    }
    throw new Error(`读取测试目录失败：${directory}`, { cause: error });
  }
  for (const entry of entries) {
    if (entry === 'node_modules' || entry.startsWith('.')) {
      continue;
    }
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) {
      walk(path, found);
    } else if (directory.includes('tests') || TEST_FILE.test(entry)) {
      found.push(path);
    }
  }
}

export function scanTests(roots: readonly string[] = ROOTS): { files: number; problems: string[] } {
  const files: string[] = [];
  for (const root of roots) {
    walk(root, files);
  }
  const problems: string[] = [];
  for (const file of files) {
    const source = readFileSync(file, 'utf8');
    const report = (pattern: RegExp, message: string): void => {
      for (const match of source.matchAll(new RegExp(pattern.source, 'g'))) {
        const line = source.slice(0, match.index).split('\n').length;
        problems.push(`${relative('.', file)}:${line}  ${message}`);
      }
    };
    for (const shape of SECRET_SHAPES) {
      report(shape.pattern, `像真的${shape.name}`);
    }
    report(ONLY_CALL, '.only( 会让别的测试不跑');
  }
  return { files: files.length, problems };
}

if (import.meta.main) {
  const { files, problems } = scanTests();
  if (problems.length > 0) {
    console.error(`测试扫描：${problems.length} 处问题`);
    for (const problem of problems) {
      console.error(`  ${problem}`);
    }
    process.exitCode = 1;
  } else {
    console.log(`测试扫描：通过（${files} 个文件）`);
  }
}
