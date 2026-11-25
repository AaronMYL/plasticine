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
