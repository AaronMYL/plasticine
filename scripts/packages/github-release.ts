// 把一次构建整理成 GitHub Release 的附件（2026-11-09 他定：安装包放本仓库的 GitHub Releases，标签 v<版本>，历史版本都留着；
// cyberhunter.top/download 只留几 KB 的 manifest.json / desktop.json / install.sh，里面的下载地址指向这里）。
// 构建工作流的 release 一步跑这个，再用 gh release create 上传 --out 里的全部文件。
//   node scripts/packages/github-release.ts --artifacts <服务包等> --desktop <桌面包> --commit <40 位 SHA> \
//     --repo AaronMYL/plasticine --out dist/release
// 打印一行 JSON：{ version, tag, files }。

import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { parseArgs } from 'node:util';
import { parseDesktopManifest, type DesktopReleaseManifest } from '../../agent/shared/desktop-release.ts';
import { parseServerManifest, sha256Hex, type ReleaseAsset } from './release-manifest.ts';
import { releaseFiles } from './publish-release.ts';
import { desktopFiles } from './publish-desktop.ts';
import { releaseManifest } from './write-release-manifest.ts';

const REPO = /^[A-Za-z0-9-]+\/[A-Za-z0-9._-]+$/;

export interface GithubReleaseOptions {
  artifacts: string;
  desktop: string;
  commit: string;
  repo: string;
  out: string;
  now?: Date;
}

export const releaseTag = (version: string): string => `v${version}`;

/** GitHub 给每个附件的固定下载地址：https://github.com/<仓库>/releases/download/<标签>/<文件名>。 */
export function assetBase(repo: string, version: string): string {
  if (!REPO.test(repo)) {
    throw new Error(`仓库名不对：${repo}`);
  }
  return `https://github.com/${repo}/releases/download/${releaseTag(version)}/`;
}

function asset(file: string, base: string): ReleaseAsset {
  const bytes = readFileSync(file);
  const name = basename(file);
  return { name, url: `${base}${encodeURIComponent(name)}`, sha256: sha256Hex(bytes), size: bytes.length };
}

export function buildGithubRelease(options: GithubReleaseOptions): { version: string; tag: string; files: string[] } {
  if (!/^[a-f0-9]{40}$/.test(options.commit)) {
    throw new Error('提交要写完整的 40 位 SHA。');
  }
  const serverManifestText = readFileSync(join(options.artifacts, 'server-manifest.json'), 'utf8');
  const { version, commit } = parseServerManifest(serverManifestText);
  if (commit !== options.commit) {
    throw new Error('服务包里的提交和这次构建的提交对不上，不发布。');
  }
  const base = assetBase(options.repo, version);
  const now = options.now ?? new Date();
  const files = releaseFiles(options.artifacts, version);
  const manifest = releaseManifest(files, serverManifestText, base, now);
  const names = desktopFiles(version);
  const desktopAssets: DesktopReleaseManifest['assets'] = {};
  const desktopPaths: string[] = [];
  for (const key of Object.keys(names) as (keyof typeof names)[]) {
    const path = join(options.desktop, names[key]);
    if (!existsSync(path)) {
      throw new Error(`这一版缺桌面包 ${names[key]}，不发布。`);
    }
    desktopAssets[key] = asset(path, base);
    desktopPaths.push(path);
  }
  const desktop = parseDesktopManifest(JSON.stringify({ schema: 1, version, commit, publishedAt: now.toISOString(),
    assets: desktopAssets }));
  mkdirSync(options.out, { recursive: true });
  const uploaded: string[] = [];
  for (const path of [...Object.values(files), ...desktopPaths]) {
    const target = join(options.out, basename(path));
    copyFileSync(path, target);
    uploaded.push(basename(path));
  }
  writeFileSync(join(options.out, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  writeFileSync(join(options.out, 'desktop.json'), `${JSON.stringify(desktop, null, 2)}\n`);
  uploaded.push('manifest.json', 'desktop.json');
  return { version, tag: releaseTag(version), files: uploaded };
}

if (import.meta.main) {
  const { values } = parseArgs({ options: {
    artifacts: { type: 'string' }, desktop: { type: 'string' }, commit: { type: 'string' },
    repo: { type: 'string' }, out: { type: 'string', default: 'dist/release' },
  } });
  if (values.artifacts === undefined || values.desktop === undefined || values.commit === undefined
    || values.repo === undefined) {
    console.error('要给 --artifacts、--desktop、--commit 和 --repo。');
    process.exitCode = 2;
  } else {
    try {
      console.log(JSON.stringify(buildGithubRelease({ artifacts: values.artifacts, desktop: values.desktop,
        commit: values.commit, repo: values.repo, out: values.out })));
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    }
  }
}
