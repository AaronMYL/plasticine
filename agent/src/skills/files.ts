import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { skillPath } from './format.ts';

export const hash = (text: string): string => createHash('sha256').update(text).digest('hex');
export type SkillFiles = Record<string, string>;
const MAX_BUNDLE_BYTES = 16 * 1024 * 1024;
const MAX_BUNDLE_FILES = 2_000;

function checkSize(bytes: number, files: number): void {
  if (bytes > MAX_BUNDLE_BYTES || files > MAX_BUNDLE_FILES) {
    throw new Error('Skill 目录超过 16 MiB 或 2000 个文件，请拆成按需引用的技能。');
  }
}

export function validateSkillFiles(files: SkillFiles): void {
  let bytes = 0;
  for (const [path, content] of Object.entries(files)) {
    skillPath(path);
    bytes += Buffer.byteLength(content, 'base64');
    checkSize(bytes, Object.keys(files).length);
  }
}

export function atomicJson(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${randomUUID()}.tmp`;
  writeFileSync(temporary, JSON.stringify(value), { mode: 0o600, flush: true });
  renameSync(temporary, path);
}

export function readSkillFiles(directory: string): SkillFiles {
  const files: SkillFiles = {};
  let bytes = 0;
  const visit = (relative: string): void => {
    for (const entry of readdirSync(join(directory, relative), { withFileTypes: true })) {
      if (entry.name.startsWith('.')) { continue; }
      const path = skillPath(relative === '' ? entry.name : `${relative}/${entry.name}`);
      if (entry.isSymbolicLink()) { throw new Error(`Skill 资源 ${path} 是链接，无法固定一个可复现的版本。`); }
      if (entry.isDirectory()) { visit(path); continue; }
      if (!entry.isFile()) { throw new Error(`Skill 资源 ${path} 不是普通文件。`); }
      const target = join(directory, path);
      checkSize(bytes + statSync(target).size, Object.keys(files).length + 1);
      const data = readFileSync(target);
      bytes += data.length;
      checkSize(bytes, Object.keys(files).length + 1);
      files[path] = data.toString('base64');
    }
  };
  visit('');
  return Object.fromEntries(Object.entries(files).sort(([a], [b]) => a.localeCompare(b)));
}

export function writeSkillFiles(directory: string, files: SkillFiles): void {
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  // Writes are synchronous, and a pending write journal resumes this full projection after a process restart.
  const previous = existsSync(join(directory, 'SKILL.md')) ? readSkillFiles(directory) : {};
  for (const path of Object.keys(previous)) {
    if (files[path] === undefined) { rmSync(join(directory, skillPath(path))); }
  }
  for (const [path, content] of Object.entries(files)) {
    const target = join(directory, skillPath(path));
    mkdirSync(dirname(target), { recursive: true, mode: 0o700 });
    const temporary = `${target}.${randomUUID()}.tmp`;
    writeFileSync(temporary, Buffer.from(content, 'base64'), { mode: 0o600, flush: true });
    renameSync(temporary, target);
  }
}
