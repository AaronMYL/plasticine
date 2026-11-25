import { createCipheriv, createDecipheriv, createHash, randomBytes, scrypt, type Hash } from 'node:crypto';
import { open, type FileHandle } from 'node:fs/promises';
import { Type, type Static } from 'typebox';
import { Value } from 'typebox/value';
import { MigrationModeSchema } from '../../../shared/api/migration.ts';

export const MAGIC = Buffer.from('PLSTMIG1', 'ascii');
export const FRAME_BYTES = 1024 * 1024;
const LAST = 0x8000_0000;
const TAG_BYTES = 16;
const DIGEST_BYTES = 32;
const HEADER_MAX = 64 * 1024;
const META_MAX = 64 * 1024;
const KDF = { n: 2 ** 17, r: 8, p: 1 } as const;
const KDF_MAX_MEMORY = 288 * 1024 * 1024;

export const MigrationHeaderSchema = Type.Object({
  format: Type.Literal('plasticine-migration-v1'),
  mode: MigrationModeSchema,
  encrypted: Type.Boolean(),
  kdf: Type.Optional(Type.Object({
    name: Type.Literal('scrypt'),
    n: Type.Integer({ minimum: 2 ** 14, maximum: 2 ** 20 }),
    r: Type.Integer({ minimum: 1, maximum: 32 }),
    p: Type.Integer({ minimum: 1, maximum: 16 }),
    salt: Type.String({ minLength: 16, maxLength: 100 }),
  })),
  nonce: Type.Optional(Type.String({ minLength: 8, maxLength: 40 })),
});
export type MigrationHeader = Static<typeof MigrationHeaderSchema>;

export class MigrationFileError extends Error {
  readonly code: 'bad_file' | 'wrong_passphrase';
  constructor(code: 'bad_file' | 'wrong_passphrase', message: string) {
    super(message);
    this.code = code;
  }
}

function bad(message: string): MigrationFileError {
  return new MigrationFileError('bad_file', message);
}

export function deriveKey(passphrase: string, kdf: NonNullable<MigrationHeader['kdf']>): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(passphrase.normalize('NFC'), Buffer.from(kdf.salt, 'base64'), 32,
      { N: kdf.n, r: kdf.r, p: kdf.p, maxmem: KDF_MAX_MEMORY }, (error, key) => {
        if (error === null) {
          resolve(key);
        } else {
          reject(error);
        }
      });
  });
}

function u32(value: number): Buffer {
  const bytes = Buffer.alloc(4);
  bytes.writeUInt32BE(value >>> 0);
  return bytes;
}

function frameAad(headerDigest: Buffer, index: number, last: boolean): Buffer {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(index));
  return Buffer.concat([headerDigest, counter, Buffer.from([last ? 1 : 0])]);
}

function frameNonce(prefix: Buffer, index: number): Buffer {
  return Buffer.concat([prefix, u32(index)]);
}

interface Crypt {
  key: Buffer;
  prefix: Buffer;
  digest: Buffer;
}

export class MigrationWriter {
  readonly #file: FileHandle;
  readonly #crypt: Crypt | null;
  #pending: Buffer[] = [];
  #pendingBytes = 0;
  #frames = 0;
  #written: number;
  #entries = 0;

  private constructor(file: FileHandle, crypt: Crypt | null, written: number) {
    this.#file = file;
    this.#crypt = crypt;
    this.#written = written;
  }

  static async create(path: string, mode: Static<typeof MigrationModeSchema>, passphrase: string | null):
    Promise<MigrationWriter> {
    const header: MigrationHeader = { format: 'plasticine-migration-v1', mode, encrypted: passphrase !== null };
    let crypt: Crypt | null = null;
    if (passphrase !== null) {
      const kdf = { name: 'scrypt' as const, ...KDF, salt: randomBytes(16).toString('base64') };
      const prefix = randomBytes(8);
      header.kdf = kdf;
      header.nonce = prefix.toString('base64');
      crypt = { key: await deriveKey(passphrase, kdf), prefix, digest: Buffer.alloc(0) };
    }
    const headerBytes = Buffer.from(JSON.stringify(header), 'utf8');
    if (crypt !== null) {
      crypt.digest = createHash('sha256').update(headerBytes).digest();
    }
    const file = await open(path, 'wx', 0o600);
    const lead = Buffer.concat([MAGIC, u32(headerBytes.length), headerBytes]);
    await file.write(lead);
    return new MigrationWriter(file, crypt, lead.length);
  }

  get bytes(): number {
    return this.#written;
  }

  async #push(bytes: Buffer): Promise<void> {
    this.#pending.push(bytes);
    this.#pendingBytes += bytes.length;
    while (this.#pendingBytes >= FRAME_BYTES) {
      const all = Buffer.concat(this.#pending);
      await this.#frame(all.subarray(0, FRAME_BYTES), false);
      const rest = all.subarray(FRAME_BYTES);
      this.#pending = rest.length === 0 ? [] : [Buffer.from(rest)];
      this.#pendingBytes = rest.length;
    }
  }

  async #frame(plain: Buffer, last: boolean): Promise<void> {
    const index = this.#frames;
    this.#frames += 1;
    let body = plain;
    let tag = Buffer.alloc(0);
    if (this.#crypt !== null) {
      const cipher = createCipheriv('aes-256-gcm', this.#crypt.key, frameNonce(this.#crypt.prefix, index));
      cipher.setAAD(frameAad(this.#crypt.digest, index, last));
      body = Buffer.concat([cipher.update(plain), cipher.final()]);
      tag = cipher.getAuthTag();
    }
    const out = Buffer.concat([u32(body.length | (last ? LAST : 0)), body, tag]);
    await this.#file.write(out);
    this.#written += out.length;
  }

  async add(path: string, source: Buffer | string, onBytes?: (bytes: number) => void): Promise<void> {
    const hash: Hash = createHash('sha256');
    if (typeof source !== 'string') {
      await this.#push(Buffer.from('F'));
      await this.#meta(path, source.length);
      hash.update(source);
      await this.#push(source);
      onBytes?.(source.length);
    } else {
      const file = await open(source, 'r');
      try {
        const size = (await file.stat()).size;
        await this.#push(Buffer.from('F'));
        await this.#meta(path, size);
        let left = size;
        const chunk = Buffer.alloc(FRAME_BYTES);
        while (left > 0) {
          const { bytesRead } = await file.read(chunk, 0, Math.min(chunk.length, left));
          if (bytesRead === 0) {
            throw new Error(`${path} 读的时候变短了`);
          }
          const piece = Buffer.from(chunk.subarray(0, bytesRead));
          hash.update(piece);
          await this.#push(piece);
          left -= bytesRead;
          onBytes?.(bytesRead);
        }
      } finally {
        await file.close();
      }
    }
    await this.#push(hash.digest());
    this.#entries += 1;
  }

  async #meta(path: string, size: number): Promise<void> {
    const meta = Buffer.from(JSON.stringify({ path, size }), 'utf8');
    await this.#push(Buffer.concat([u32(meta.length), meta]));
  }

  async finish(): Promise<number> {
    const end = Buffer.from(JSON.stringify({ entries: this.#entries }), 'utf8');
    await this.#push(Buffer.concat([Buffer.from('E'), u32(end.length), end]));
    await this.#frame(Buffer.concat(this.#pending), true);
    this.#pending = [];
    this.#pendingBytes = 0;
    await this.#file.sync();
    await this.#file.close();
    return this.#written;
  }

  async abort(): Promise<void> {
    await this.#file.close().catch(() => undefined);
  }
}

export async function readHeader(path: string): Promise<{ header: MigrationHeader; bodyOffset: number;
  digest: Buffer }> {
  const file = await open(path, 'r');
  try {
    const lead = Buffer.alloc(MAGIC.length + 4);
    const { bytesRead } = await file.read(lead, 0, lead.length, 0);
    if (bytesRead < lead.length || !lead.subarray(0, MAGIC.length).equals(MAGIC)) {
      throw bad('这不是 Plasticine 导出的迁移文件。');
    }
    const length = lead.readUInt32BE(MAGIC.length);
    if (length > HEADER_MAX) {
      throw bad('迁移文件的开头坏了。');
    }
    const headerBytes = Buffer.alloc(length);
    const got = await file.read(headerBytes, 0, length, lead.length);
    if (got.bytesRead < length) {
      throw bad('迁移文件不完整。');
    }
    let header: unknown;
    try {
      header = JSON.parse(headerBytes.toString('utf8'));
    } catch {
      throw bad('迁移文件的开头坏了。');
    }
    if (!Value.Check(MigrationHeaderSchema, header) || header.encrypted !== (header.kdf !== undefined)
      || header.encrypted !== (header.nonce !== undefined)) {
      throw bad('迁移文件的开头认不出来，可能是更新的版本导出的。');
    }
    return { header, bodyOffset: lead.length + length, digest: createHash('sha256').update(headerBytes).digest() };
  } finally {
    await file.close();
  }
}

export interface EntrySink {
  write(chunk: Buffer): Promise<void>;
  close(): Promise<void>;
}

export interface ReadVisitor {
  begin(path: string, size: number): Promise<EntrySink | null>;
  stop?(): boolean;
  progress?(offset: number): void;
}

async function* frames(file: FileHandle, start: number, size: number, digest: Buffer, crypt: Crypt | null,
  progress?: (offset: number) => void): AsyncGenerator<Buffer> {
  let offset = start;
  let index = 0;
  let last = false;
  const lead = Buffer.alloc(4);
  while (!last) {
    if (offset + 4 > size) {
      throw bad('迁移文件不完整（结尾少了一截）。');
    }
    await file.read(lead, 0, 4, offset);
    const word = lead.readUInt32BE(0);
    last = (word & LAST) !== 0;
    const length = word & 0x7fff_ffff;
    const tagBytes = crypt === null ? 0 : TAG_BYTES;
    if (length > FRAME_BYTES + 16 || offset + 4 + length + tagBytes > size) {
      throw bad('迁移文件不完整（结尾少了一截）。');
    }
    const body = Buffer.alloc(length + tagBytes);
    await file.read(body, 0, body.length, offset + 4);
    offset += 4 + body.length;
    if (crypt === null) {
      yield body;
    } else {
      const decipher = createDecipheriv('aes-256-gcm', crypt.key, frameNonce(crypt.prefix, index));
      decipher.setAAD(frameAad(digest, index, last));
      decipher.setAuthTag(body.subarray(length));
      try {
        yield Buffer.concat([decipher.update(body.subarray(0, length)), decipher.final()]);
      } catch {
        if (index === 0) {
          throw new MigrationFileError('wrong_passphrase', '口令不对，再试一次。');
        }
        throw bad('迁移文件校验不过，可能传坏了。');
      }
    }
    progress?.(offset);
    index += 1;
  }
  if (offset !== size) {
    throw bad('迁移文件结尾多出了东西。');
  }
}

class ByteQueue {
  readonly #source: AsyncGenerator<Buffer>;
  #chunks: Buffer[] = [];
  #length = 0;

  constructor(source: AsyncGenerator<Buffer>) {
    this.#source = source;
  }

  async #fill(bytes: number): Promise<boolean> {
    while (this.#length < bytes) {
      const next = await this.#source.next();
      if (next.done === true) {
        return false;
      }
      this.#chunks.push(next.value);
      this.#length += next.value.length;
    }
    return true;
  }

  async take(bytes: number): Promise<Buffer> {
    if (!(await this.#fill(bytes))) {
      throw bad('迁移文件不完整（记录少了一截）。');
    }
    const all = this.#chunks.length === 1 ? this.#chunks[0]! : Buffer.concat(this.#chunks);
    const out = all.subarray(0, bytes);
    const rest = all.subarray(bytes);
    this.#chunks = rest.length === 0 ? [] : [rest];
    this.#length = rest.length;
    return out;
  }

  async some(max: number): Promise<Buffer> {
    if (this.#length === 0 && !(await this.#fill(1))) {
      throw bad('迁移文件不完整（记录少了一截）。');
    }
    return this.take(Math.min(max, this.#length));
  }

  async empty(): Promise<boolean> {
    return this.#length === 0 && !(await this.#fill(1));
  }
}

async function metaOf(queue: ByteQueue): Promise<Record<string, unknown>> {
  const length = (await queue.take(4)).readUInt32BE(0);
  if (length > META_MAX) {
    throw bad('迁移文件里有一条记录坏了。');
  }
  try {
    const value: unknown = JSON.parse((await queue.take(length)).toString('utf8'));
    if (typeof value !== 'object' || value === null) {
      throw new Error('not an object');
    }
    return value as Record<string, unknown>;
  } catch {
    throw bad('迁移文件里有一条记录坏了。');
  }
}

export async function readArchive(path: string, passphraseKey: Buffer | null, visitor: ReadVisitor):
  Promise<number> {
  const { header, bodyOffset, digest } = await readHeader(path);
  if (header.encrypted && passphraseKey === null) {
    throw new MigrationFileError('wrong_passphrase', '这一份加了密，要输导出时设的口令。');
  }
  const crypt = header.encrypted && passphraseKey !== null
    ? { key: passphraseKey, prefix: Buffer.from(header.nonce ?? '', 'base64'), digest } : null;
  const file = await open(path, 'r');
  let count = 0;
  try {
    const size = (await file.stat()).size;
    const queue = new ByteQueue(frames(file, bodyOffset, size, digest, crypt, visitor.progress));
    for (;;) {
      const type = (await queue.take(1)).toString('ascii');
      const meta = await metaOf(queue);
      if (type === 'E') {
        if (meta['entries'] !== count || !(await queue.empty())) {
          throw bad('迁移文件的结尾对不上。');
        }
        return count;
      }
      const entryPath = meta['path'];
      const entrySize = meta['size'];
      if (type !== 'F' || typeof entryPath !== 'string' || !Number.isSafeInteger(entrySize) || Number(entrySize) < 0) {
        throw bad('迁移文件里有一条记录坏了。');
      }
      const sink = await visitor.begin(entryPath, Number(entrySize));
      const hash = createHash('sha256');
      let left = Number(entrySize);
      try {
        while (left > 0) {
          const piece = await queue.some(Math.min(left, FRAME_BYTES));
          hash.update(piece);
          await sink?.write(piece);
          left -= piece.length;
        }
      } finally {
        await sink?.close();
      }
      if (!hash.digest().equals(await queue.take(DIGEST_BYTES))) {
        throw bad(`迁移文件里 ${entryPath} 校验不过，可能传坏了。`);
      }
      count += 1;
      if (visitor.stop?.() === true) {
        return count;
      }
    }
  } finally {
    await file.close();
  }
}
