// electron-builder 的 afterPack 钩子，在签名之前跑：
// 1. 把本体的依赖补进 resources/server/node_modules。electron-builder 往 extraResources 里拷文件时一律跳过
//    node_modules（写 filter 也一样，11-08 在本机复现过），不补的话装好的本体一启动就报找不到 typebox。
// 2. Mac 上先给设备助手做临时签名。助手是 lipo 合成的通用二进制、没有签名；electron-builder 按文件名顺序签，
//    「Plasticine」排在「plasticine-helper」前面，签主程序时会因为同目录的助手没签而失败（11-08 CI 两次）。

import { execFileSync } from 'node:child_process';
import { cpSync, existsSync } from 'node:fs';
import { join } from 'node:path';

interface PackContext {
  appOutDir: string;
  electronPlatformName: string;
  packager: { appInfo: { productFilename: string } };
}

export function resourcesDir(context: PackContext): string {
  if (context.electronPlatformName === 'darwin') {
    return join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`, 'Contents', 'Resources');
  }
  return join(context.appOutDir, 'resources');
}

export default function afterPack(context: PackContext): void {
  const source = join(import.meta.dirname, '..', 'stage', 'server', 'node_modules');
  if (!existsSync(source)) {
    throw new Error(`没有 ${source}：先把服务端包解到 desktop/stage/server`);
  }
  const target = join(resourcesDir(context), 'server', 'node_modules');
  cpSync(source, target, { recursive: true, force: true, verbatimSymlinks: true });
  if (context.electronPlatformName === 'darwin') {
    const helper = join(resourcesDir(context), '..', 'MacOS', 'plasticine-helper');
    execFileSync('codesign', ['--sign', '-', '--force', helper], { stdio: 'inherit' });
  }
}
