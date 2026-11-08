// 节点凭证（这台电脑和本体配对后拿到的长期凭证）：用系统钥匙串加密存（Electron 的 safeStorage：Mac 是钥匙串里的
// 「Plasticine Safe Storage」，Windows 是 DPAPI），他 11-06 定照默认用钥匙串、弹框时点「始终允许」；固定不住签名也照样
// 用钥匙串，不退回明文。按本体源地址分开：<目录>/<源地址的 SHA-256>.bin，目录 0700、文件 0600，原子替换。
// Swift 版的明文凭证（node-credential/<同一个摘要>）只在这里没有时读一次搬进来，旧文件不删（不删数据），
// 这样换成 Electron 版不用重新配对。凭证不写日志、不进错误信息。

import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export interface SecretCipher {
  available(): boolean;
  encrypt(text: string): Buffer;
  decrypt(data: Buffer): string;
}

function readOrNull(file: string): Buffer | null {
  try {
    return readFileSync(file);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return null;
    }
    throw error;
  }
}

/** Swift 版按 URL.absoluteString（带结尾的 /）算摘要。 */
export function serverKey(server: string): string {
  return createHash('sha256').update(`${new URL(server).origin}/`).digest('hex');
}

export class CredentialStore {
  private readonly directory: string;
  private readonly legacy: string | null;
  private readonly cipher: SecretCipher;

  constructor(directory: string, legacy: string | null, cipher: SecretCipher) {
    this.directory = directory;
    this.legacy = legacy;
    this.cipher = cipher;
  }

  read(server: string): string | null {
    const key = serverKey(server);
    const sealed = readOrNull(join(this.directory, `${key}.bin`));
    if (sealed !== null) {
      this.requireCipher();
      const value = this.cipher.decrypt(sealed);
      if (value === '') {
        throw new Error('配对凭证解不开或是空的，请重新配对这台电脑。');
      }
      return value;
    }
    const old = this.legacy === null ? null : readOrNull(join(this.legacy, key));
    if (old === null || old.length === 0) {
      return null;
    }
    const value = old.toString('utf8');
    this.save(server, value);
    return value;
  }

  save(server: string, credential: string): void {
    if (credential === '') {
      throw new Error('配对回答里没有凭证，请重新配对。');
    }
    this.requireCipher();
    mkdirSync(this.directory, { recursive: true, mode: 0o700 });
    const file = join(this.directory, `${serverKey(server)}.bin`);
    const temporary = `${file}.partial-${process.pid}`;
    writeFileSync(temporary, this.cipher.encrypt(credential), { mode: 0o600 });
    renameSync(temporary, file);
  }

  /** 本体说凭证作废了（401）：只删 Electron 版自己的那份，Swift 版的旧文件不碰。 */
  forget(server: string): void {
    rmSync(join(this.directory, `${serverKey(server)}.bin`), { force: true });
  }

  private requireCipher(): void {
    if (!this.cipher.available()) {
      throw new Error('系统钥匙串现在用不了，配对凭证没法加密保存。解锁钥匙串后再试。');
    }
  }
}
