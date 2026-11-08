// Mac 的自签代码签名身份（只自用，不开付费开发者账号；和 Swift 版 self-signing.swift 同一张证书）：登录钥匙串里的
// 「Plasticine Local Signing」。每个版本都用它重签，签名身份就固定了：钥匙串里 Plasticine Safe Storage 那一项、屏幕录制
// 和辅助功能的授权都认这个身份，更新后不再弹框、不丢权限（他 11-06 定）。第一次用这张证书签时系统会问一次能不能用私钥，
// 点「始终允许」。全程用系统自带的 openssl / security / codesign；私钥、证书、一次性口令只在临时目录里，用完即删。

import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';

export const SIGNING_IDENTITY = 'Plasticine Local Signing';

const OPENSSL_CONFIG = [
  '[req]', 'distinguished_name = dn', '[dn]', '[codesign]', 'basicConstraints = critical,CA:false',
  'keyUsage = critical,digitalSignature', 'extendedKeyUsage = critical,codeSigning', '',
].join('\n');

interface Ran {
  ok: boolean;
  stdout: string;
  stderr: string;
}

function run(file: string, args: readonly string[], input?: string): Promise<Ran> {
  return new Promise((resolve) => {
    const child = execFile(file, [...args], { maxBuffer: 4 * 1024 * 1024 }, (error, stdout, stderr) => {
      resolve({ ok: error === null, stdout, stderr });
    });
    if (input !== undefined) {
      child.stdin?.end(input);
    }
  });
}

function loginKeychain(): string {
  return join(homedir(), 'Library', 'Keychains', 'login.keychain-db');
}

export async function hasIdentity(): Promise<boolean> {
  return (await run('/usr/bin/security', ['find-certificate', '-c', SIGNING_IDENTITY, loginKeychain()])).ok;
}

async function generate(): Promise<void> {
  const directory = mkdtempSync(join(tmpdir(), 'plasticine-signing-'));
  try {
    const key = join(directory, 'key.pem');
    const certificate = join(directory, 'cert.pem');
    const bundle = join(directory, 'identity.p12');
    const config = join(directory, 'openssl.cnf');
    writeFileSync(config, OPENSSL_CONFIG, { mode: 0o600 });
    const made = await run('/usr/bin/openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-keyout', key, '-out',
      certificate, '-days', '3650', '-nodes', '-subj', `/CN=${SIGNING_IDENTITY}`, '-config', config,
      '-extensions', 'codesign']);
    if (!made.ok) {
      throw new Error('没能生成自签证书，请确认系统自带的 openssl 可用。');
    }
    const passphrase = randomUUID();
    const packed = await run('/usr/bin/openssl', ['pkcs12', '-export', '-inkey', key, '-in', certificate, '-name',
      SIGNING_IDENTITY, '-out', bundle, '-passout', 'stdin'], `${passphrase}\n`);
    if (!packed.ok) {
      throw new Error('没能打包自签证书。');
    }
    const imported = await run('/usr/bin/security', ['import', bundle, '-k', loginKeychain(), '-P', passphrase,
      '-T', '/usr/bin/codesign', '-x']);
    if (!imported.ok) {
      throw new Error('没能把自签证书放进登录钥匙串。');
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

/** 没有这张证书就生成一张；回可用于 codesign -s 的身份名。 */
export async function ensureIdentity(): Promise<string> {
  if (!await hasIdentity()) {
    await generate();
  }
  return SIGNING_IDENTITY;
}

/** 用本机证书重签整个 .app 并核对。 */
export async function resign(app: string): Promise<void> {
  const identity = await ensureIdentity();
  const signed = await run('/usr/bin/codesign', ['--force', '--deep', '-s', identity, app]);
  if (!signed.ok) {
    throw new Error('用本机证书重签新版没成，保留当前版本。');
  }
  const verified = await run('/usr/bin/codesign', ['--verify', '--deep', '--strict', app]);
  if (!verified.ok) {
    throw new Error('新版签名核对没过，保留当前版本。');
  }
}

/** 这个 .app 是不是已经用本机证书签的。 */
export async function signedLocally(app: string): Promise<boolean> {
  const shown = await run('/usr/bin/codesign', ['-dv', '--verbose=2', app]);
  return `${shown.stdout}\n${shown.stderr}`.includes(`Authority=${SIGNING_IDENTITY}`);
}

export const runTool = run;
