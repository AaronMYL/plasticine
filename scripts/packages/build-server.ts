import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import { applyExclusions, EXCLUSIONS_DOC } from './exclusions.ts';
import { auditPackage, INCLUDED_PATHS } from './package-contents.ts';
import { DEFAULT_RELEASE_URL, MANIFEST_FILE, MINIMUM_NODE, packageVersion, SERVER_PACKAGE, sha256Hex,
  type ServerManifest } from './release-manifest.ts';

export interface BuildOptions {
  repo: string;
  out: string;
  commit?: string;
  version?: string;
  releaseUrl?: string;
  skipClientBuild?: boolean;
  log?: (line: string) => void;
}

export interface BuildResult {
  file: string;
  name: string;
  sha256: string;
  size: number;
  version: string;
  commit: string;
}

type Run = (command: string, args: readonly string[], options?: { cwd?: string; env?: NodeJS.ProcessEnv }) => string;

const defaultRun: Run = (command, args, options = {}) => execFileSync(command, args, {
  cwd: options.cwd, env: options.env ?? process.env, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024,
  stdio: ['ignore', 'pipe', 'inherit'],
}).trim();

export function serverArchiveName(version: string): string {
  return `${SERVER_PACKAGE}-${version}.tar.gz`;
}

function buildClient(options: BuildOptions, commit: string, committedAt: string, run: Run): void {
  const head = run('git', ['-C', options.repo, 'rev-parse', 'HEAD']);
  const dirty = run('git', ['-C', options.repo, 'status', '--porcelain', '--', 'client', 'agent/shared',
    'agent/protocol']);
  if (head !== commit || dirty !== '') {
    throw new Error('客户端在工作区构建：先 checkout 到要打包的提交，并且 client/、agent/shared/、agent/protocol/ 没有未提交的改动。');
  }
  run('npm', ['run', '-s', 'build', '-w', 'client'], { cwd: options.repo,
    env: { ...process.env, PLASTICINE_BUILD_ID: commit, PLASTICINE_BUILT_AT: committedAt } });
}

function copyClient(options: BuildOptions, packageDir: string, commit: string): void {
  const dist = join(options.repo, 'client', 'dist');
  const manifest = join(dist, 'client-manifest.json');
  if (!existsSync(manifest)) {
    throw new Error('没有 client/dist/client-manifest.json：客户端还没构建。');
  }
  const buildId = (JSON.parse(readFileSync(manifest, 'utf8')) as { buildId?: unknown }).buildId;
  if (buildId !== commit) {
    throw new Error(`client/dist 是 ${String(buildId)} 构建的，不是 ${commit}；去掉 --skip-client-build 重新构建。`);
  }
  cpSync(dist, join(packageDir, 'client', 'dist'), { recursive: true });
}

function productionDependencies(packageDir: string, run: Run): void {
  run('npm', ['ci', '--omit=dev', '--omit=optional', '--workspace', 'agent', '--include-workspace-root',
    '--ignore-scripts', '--no-audit', '--no-fund', '--loglevel=error'], { cwd: packageDir });
  const binaries = run('find', [join(packageDir, 'node_modules'), '-name', '*.node', '-type', 'f']);
  if (binaries !== '') {
    throw new Error(`生产依赖里有原生模块，服务包就不能跨平台了：\n${binaries}`);
  }
  rmSync(join(packageDir, 'node_modules', '.bin'), { recursive: true, force: true });
  rmSync(join(packageDir, 'node_modules', '@plasticine'), { recursive: true, force: true });
  const links = run('find', [packageDir, '-type', 'l']);
  if (links !== '') {
    throw new Error(`服务包里还有符号链接，Windows 上解不开：\n${links}`);
  }
}

function archive(stage: string, out: string, version: string, committedAt: string, run: Run): string {
  mkdirSync(out, { recursive: true });
  const file = join(out, serverArchiveName(version));
  const gnu = run('tar', ['--version']).includes('GNU tar');
  const mtime = `--mtime=@${Math.floor(new Date(committedAt).getTime() / 1000)}`;
  const stable = gnu ? ['--sort=name', '--owner=0', '--group=0', '--numeric-owner', mtime] : [];
  run('tar', [...stable, '-czf', file, '-C', stage, SERVER_PACKAGE]);
  return file;
}

export function buildServer(options: BuildOptions, run: Run = defaultRun): BuildResult {
  const log = options.log ?? ((line: string) => console.error(line));
  const commit = run('git', ['-C', options.repo, 'rev-parse', '--verify', `${options.commit ?? 'HEAD'}^{commit}`]);
  const committedAt = new Date(run('git', ['-C', options.repo, 'show', '-s', '--format=%cI', commit, '--']))
    .toISOString();
  const version = options.version ?? packageVersion(new Date(committedAt));
  const stage = mkdtempSync(join(tmpdir(), 'plasticine-package-'));
  try {
    const packageDir = join(stage, SERVER_PACKAGE);
    mkdirSync(packageDir);
    log(`取源码 ${commit.slice(0, 7)}（版本 ${version}）`);
    const tarball = join(stage, 'source.tar');
    run('git', ['-C', options.repo, 'archive', '--format=tar', '-o', tarball, commit, '--', ...INCLUDED_PATHS]);
    run('tar', ['-xf', tarball, '-C', packageDir]);
    rmSync(tarball);
    const excluded = applyExclusions(packageDir,
      run('git', ['-C', options.repo, 'show', `${commit}:${EXCLUSIONS_DOC}`]));
    if (options.skipClientBuild !== true) {
      log('构建客户端');
      buildClient(options, commit, committedAt, run);
    }
    copyClient(options, packageDir, commit);
    log('装生产依赖');
    productionDependencies(packageDir, run);
    const manifest: ServerManifest = { schema: 1, name: SERVER_PACKAGE, version, commit, builtAt: committedAt,
      node: `>=${MINIMUM_NODE}`, releaseUrl: options.releaseUrl ?? DEFAULT_RELEASE_URL, excluded };
    writeFileSync(join(packageDir, MANIFEST_FILE), `${JSON.stringify(manifest, null, 2)}\n`);
    const problems = auditPackage(packageDir);
    if (problems.length > 0) {
      throw new Error(`服务包里有不该有的东西：\n${problems.join('\n')}`);
    }
    log('打包');
    const file = archive(stage, options.out, version, committedAt, run);
    const bytes = readFileSync(file);
    return { file, name: serverArchiveName(version), sha256: sha256Hex(bytes), size: statSync(file).size,
      version, commit };
  } finally {
    rmSync(stage, { recursive: true, force: true });
  }
}

if (import.meta.main) {
  const { values } = parseArgs({ options: {
    out: { type: 'string', default: 'dist/packages' },
    commit: { type: 'string' },
    version: { type: 'string' },
    'release-url': { type: 'string' },
    'skip-client-build': { type: 'boolean', default: false },
  } });
  const repo = fileURLToPath(new URL('../..', import.meta.url));
  const result = buildServer({ repo, out: resolve(values.out),
    ...(values.commit === undefined ? {} : { commit: values.commit }),
    ...(values.version === undefined ? {} : { version: values.version }),
    ...(values['release-url'] === undefined ? {} : { releaseUrl: values['release-url'] }),
    skipClientBuild: values['skip-client-build'] });
  console.log(JSON.stringify(result));
}
