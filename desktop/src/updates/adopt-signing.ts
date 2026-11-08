// Mac 第一次打开（以及他手动装了新的一版）时，把自己换成用本机证书签的同一份（他 11-06 定：签名身份固定下来，
// 钥匙串尽量只弹一次）。要在碰钥匙串（safeStorage、网页数据加密）之前做：复制一份自己 → 用「Plasticine Local Signing」
// 重签 → 客户端退出后由换版本的脚本只换 Contents、重新打开（Dock 图标照旧能用）。第一次签名时系统会问一次能不能用
// 那张证书的私钥，点「始终允许」。每个版本只试一次；没换成就照常用（照样用钥匙串，不退回明文）。

import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { canonicalVersion } from './update-manager.ts';
import { macSwapScript, HEALTH_WAIT_SECONDS } from './update-scripts.ts';

const LSREGISTER = '/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/'
  + 'lsregister';

export interface AdoptDeps {
  app: string;
  version: string;
  directory: string;
  pid: number;
  signedLocally(app: string): Promise<boolean>;
  copy(from: string, to: string): Promise<void>;
  resign(app: string): Promise<void>;
  launchDetached(file: string, args: readonly string[]): void;
  log(line: string): void;
}

/** 换成了就回 true（调用方马上退出，让脚本接手）；不用换、换不成都回 false，照常打开。 */
export async function adoptLocalSigning(deps: AdoptDeps): Promise<boolean> {
  const version = canonicalVersion(deps.version);
  const attempted = join(deps.directory, `adopt-${version}`);
  if (deps.app.includes('/AppTranslocation/') || existsSync(attempted) || await deps.signedLocally(deps.app)) {
    return false;
  }
  mkdirSync(deps.directory, { recursive: true });
  writeFileSync(attempted, new Date().toISOString());
  const staging = join(deps.directory, 'staging', `adopt-${version}`);
  try {
    rmSync(staging, { recursive: true, force: true });
    mkdirSync(staging, { recursive: true });
    const incoming = join(staging, 'Plasticine.app');
    await deps.copy(deps.app, incoming);
    await deps.resign(incoming);
    const script = join(deps.directory, 'adopt.sh');
    writeFileSync(script, macSwapScript({ pid: deps.pid, app: deps.app, incoming,
      previous: join(deps.directory, 'previous', 'Plasticine.app'), marker: join(deps.directory, `started-${version}`),
      rolledBack: join(deps.directory, 'rolled-back.json'), version, open: '/usr/bin/open', lsregister: LSREGISTER,
      waitSeconds: HEALTH_WAIT_SECONDS }), { mode: 0o700 });
    deps.launchDetached('/bin/sh', [script]);
    return true;
  } catch (error) {
    deps.log(`没换成本机证书签的那一份，照常打开：${error instanceof Error ? error.message : String(error)}`);
    return false;
  }
}
