import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join, normalize, sep } from 'node:path';

const MAIL_DIRECTORY = 'mail';
const DIRECTORY_MODE = 0o700;
const FILE_MODE = 0o600;
const SAFE_ID = /^[A-Za-z0-9_-]{1,80}$/;

export interface StoredRaw {
  rawPath: string;
  rawSha256: string;
}

function checkId(id: string): string {
  if (!SAFE_ID.test(id)) {
    throw new Error(`站内信 id「${id}」不能当文件名，原信没有存`);
  }
  return id;
}

export class MailFiles {
  readonly #root: string;

  constructor(stateDirectory: string) {
    this.#root = stateDirectory;
  }

  #write(relative: string, data: Buffer): void {
    const target = join(this.#root, relative);
    mkdirSync(dirname(target), { recursive: true, mode: DIRECTORY_MODE });
    const temporary = `${target}.${randomUUID()}.tmp`;
    writeFileSync(temporary, data, { mode: FILE_MODE, flush: true });
    renameSync(temporary, target);
  }

  writeRaw(id: string, raw: Buffer): StoredRaw {
    const rawPath = [MAIL_DIRECTORY, 'raw', `${checkId(id)}.eml`].join('/');
    this.#write(rawPath, raw);
    return { rawPath, rawSha256: createHash('sha256').update(raw).digest('hex') };
  }

  writePart(id: string, index: number, data: Buffer): string {
    if (!Number.isSafeInteger(index) || index < 0) {
      throw new Error('内嵌分段的序号不对，没有存');
    }
    const path = [MAIL_DIRECTORY, 'parts', checkId(id), String(index)].join('/');
    this.#write(path, data);
    return path;
  }

  read(relative: string): Buffer {
    const clean = normalize(relative);
    if (!clean.startsWith(`${MAIL_DIRECTORY}${sep}`) || clean.split(sep).includes('..')) {
      throw new Error('邮件文件的路径不在 mail/ 下面，没有读');
    }
    return readFileSync(join(this.#root, clean));
  }
}
