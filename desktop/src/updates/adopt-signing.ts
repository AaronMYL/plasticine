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
