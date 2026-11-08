import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { PublishCommands } from '../../publish-mac-update.ts';
import { DEFAULT_RELEASE_URL, sha256Hex } from '../release-manifest.ts';

export function publishScratch(t: { after(fn: () => void): void }): string {
  const root = mkdtempSync(join(tmpdir(), 'plasticine-packages-publish-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}

export function packageArtifacts(root: string, version: string, commit: string, appVersion = '0.7.3'): string {
  const directory = join(root, `artifacts-${version}`);
  mkdirSync(directory, { recursive: true });
  const server = { schema: 1, name: 'plasticine-server', version, commit,
    builtAt: '2026-11-06T12:00:00.000Z', node: '>=24.11', releaseUrl: DEFAULT_RELEASE_URL, excluded: [] };
  writeFileSync(join(directory, `plasticine-server-${version}.tar.gz`), `server ${commit}`);
  writeFileSync(join(directory, 'install.sh'), `#!/bin/sh\n# ${version}\n`);
  writeFileSync(join(directory, `Plasticine-Setup-${version}.exe`), `windows ${commit}`);
  writeFileSync(join(directory, 'server-manifest.json'), JSON.stringify(server));
  // 真 ZIP / plist，直接检验生成器从包内读身份，而不是只信另一个同名文件。
  const zip = join(directory, `Plasticine-mac-${version}.zip`);
  const made = spawnSync('python3', ['-c', [
    'import json, plistlib, sys, zipfile',
    'data = json.load(sys.stdin)',
    'with zipfile.ZipFile(data["zip"], "w") as package:',
    '    info = {"CFBundleShortVersionString": data["appVersion"]}',
    '    package.writestr("Plasticine.app/Contents/Info.plist", plistlib.dumps(info))',
    '    package.writestr("Plasticine.app/Contents/Resources/server/manifest.json", json.dumps(data["server"]))',
  ].join('\n')], { input: JSON.stringify({ zip, appVersion, server }), encoding: 'utf8' });
  assert.equal(made.status, 0, made.stderr);
  return directory;
}

export function identifyMac(artifacts: string, version: string, commit: string) {
  return spawnSync('python3', [fileURLToPath(new URL('../mac/package-identity.py', import.meta.url)),
    '--zip', join(artifacts, `Plasticine-mac-${version}.zip`), '--version', version, '--commit', commit,
    '--out', join(artifacts, 'mac-package.json')], { encoding: 'utf8' });
}

/** 用真实文件模拟 sudo 的少数落盘命令；可在 latest 原子切换前注入一次失败。 */
export function legacyPublisher(root: string) {
  const stateDirectory = join(root, 'state');
  const directory = join(stateDirectory, 'downloads/mac');
  const latest = join(directory, 'latest.json');
  const calls: string[][] = [];
  const logs: string[] = [];
  const failures = { nextLatest: false };
  let temporary = 0;
  const commands: PublishCommands = {
    sha256: async (path) => sha256Hex(readFileSync(path)),
    writeTemp: async (text) => {
      const path = join(root, `latest-${temporary++}.json`);
      writeFileSync(path, text);
      return path;
    },
    log: (message) => logs.push(message),
    run: async (command, args) => {
      assert.equal(command, 'sudo');
      calls.push([...args]);
      const target = args.at(-1) ?? '';
      if (args.includes('test')) return { code: existsSync(target) ? 0 : 1, stdout: '' };
      if (args.includes('cat')) return { code: 0, stdout: readFileSync(target, 'utf8') };
      if (args.includes('sha256sum')) return { code: 0, stdout: `${sha256Hex(readFileSync(target))}  ${target}\n` };
      if (args.includes('install')) {
        if (failures.nextLatest && target.endsWith('/.latest.json.part')) {
          failures.nextLatest = false;
          return { code: 1, stdout: '', stderr: 'injected latest failure' };
        }
        if (args.includes('-d')) mkdirSync(target, { recursive: true });
        else copyFileSync(args.at(-2) ?? '', target);
      } else if (args.includes('mv')) renameSync(args.at(-2) ?? '', target);
      else assert.fail(`unexpected command ${args.join(' ')}`);
      return { code: 0, stdout: '' };
    },
  };
  function seed(version = '0.7.2', commit = '0'.repeat(40)): string {
    mkdirSync(dirname(latest), { recursive: true });
    const file = `Plasticine-${version}.zip`;
    const content = `previous mac ${commit}`;
    writeFileSync(join(directory, file), content);
    writeFileSync(latest, JSON.stringify({ version, file, commit, sha256: sha256Hex(Buffer.from(content)) }));
    return readFileSync(latest, 'utf8');
  }
  return { stateDirectory, directory, latest, commands, calls, logs, failures, seed };
}
