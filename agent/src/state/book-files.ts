// 书的文件（用户 2026-11-01 定「图书」）：books/<书 id>/ 下放原文件、转好的章节 content.json 和插图 assets/。
// 先写进同级的临时目录再整体改名，崩在半路也只会留下一个没人引用的临时目录，不会有半本书。这里不删任何文件。

import { mkdirSync, readFileSync, renameSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Type, type Static } from 'typebox';
import { Value } from 'typebox/value';
import { StateError } from './errors.ts';

const DIRECTORY_MODE = 0o700;
const FILE_MODE = 0o600;
const CONTENT_FILE = 'content.json';
const ASSETS_DIRECTORY = 'assets';
const SOURCE_BASENAME = 'source';
// 书的 id 来自 state/（UUID），插图的 key 来自解析层；两者都不能带路径分隔符离开 books/。
const BOOK_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,99}$/;
const ASSET_KEY_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
const SOURCE_EXTENSIONS = new Set(['epub', 'txt', 'mobi', 'azw3']);
// 一次只读一两本书，缓存最近 4 本的章节就够；大部头的 content.json 有几 MB，不每章都重新读一遍。
const CONTENT_CACHE_SIZE = 4;

const BookContentSchema = Type.Object({
  version: Type.Literal(1),
  chapters: Type.Array(Type.Object({ title: Type.String(), html: Type.String(), text: Type.String() })),
  images: Type.Array(Type.Object({ key: Type.String(), mime: Type.String() })),
});
export type BookContent = Static<typeof BookContentSchema>;
export type BookChapterFile = BookContent['chapters'][number];

export interface BookImageFile {
  key: string;
  mime: string;
  bytes: Buffer;
}

export interface BookFilesInput {
  source: Buffer;
  format: string;
  chapters: BookChapterFile[];
  images: BookImageFile[];
}

export class BookFiles {
  readonly #directory: string | undefined;
  readonly #cache = new Map<string, BookContent>();

  constructor(directory: string | undefined) {
    this.#directory = directory;
  }

  get directory(): string {
    if (this.#directory === undefined) {
      throw new StateError('invalid_input', '这个库没有配置图书目录，存不了书');
    }
    return this.#directory;
  }

  folderFor(bookId: string): string {
    if (!BOOK_ID_PATTERN.test(bookId)) {
      throw new StateError('invalid_input', `书的编号 ${bookId} 不能用作目录名`, { field: 'id' });
    }
    return join(this.directory, bookId);
  }

  /** 整本写进临时目录再改名；目录已存在说明这本书已经存过，拒绝覆盖。 */
  write(bookId: string, input: BookFilesInput): void {
    if (!SOURCE_EXTENSIONS.has(input.format)) {
      throw new StateError('invalid_input', `不认识的书格式 ${input.format}`, { field: 'format' });
    }
    const target = this.folderFor(bookId);
    if (existsSync(target)) {
      throw new StateError('duplicate', `书 ${bookId} 的文件已经在了，不覆盖`);
    }
    mkdirSync(this.directory, { recursive: true, mode: DIRECTORY_MODE });
    const staging = join(this.directory, `.incoming-${bookId}-${randomUUID()}`);
    mkdirSync(join(staging, ASSETS_DIRECTORY), { recursive: true, mode: DIRECTORY_MODE });
    writeFileSync(join(staging, `${SOURCE_BASENAME}.${input.format}`), input.source, { mode: FILE_MODE });
    for (const image of input.images) {
      if (!ASSET_KEY_PATTERN.test(image.key)) {
        throw new StateError('invalid_input', `插图名 ${image.key} 不能用作文件名`, { field: 'images' });
      }
      writeFileSync(join(staging, ASSETS_DIRECTORY, image.key), image.bytes, { mode: FILE_MODE });
    }
    const content: BookContent = {
      version: 1,
      chapters: input.chapters,
      images: input.images.map((image) => ({ key: image.key, mime: image.mime })),
    };
    writeFileSync(join(staging, CONTENT_FILE), JSON.stringify(content), { mode: FILE_MODE });
    renameSync(staging, target);
  }

  content(bookId: string): BookContent {
    const cached = this.#cache.get(bookId);
    if (cached !== undefined) {
      this.#cache.delete(bookId);
      this.#cache.set(bookId, cached);
      return cached;
    }
    const path = join(this.folderFor(bookId), CONTENT_FILE);
    const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'));
    if (!Value.Check(BookContentSchema, parsed)) {
      throw new StateError('invalid_input', `书 ${bookId} 的章节文件格式不对，需要重新导入这本书`);
    }
    this.#cache.set(bookId, parsed);
    while (this.#cache.size > CONTENT_CACHE_SIZE) {
      const oldest = this.#cache.keys().next().value;
      if (oldest === undefined) {
        break;
      }
      this.#cache.delete(oldest);
    }
    return parsed;
  }

  chapter(bookId: string, index: number): BookChapterFile {
    const found = this.content(bookId).chapters[index];
    if (found === undefined) {
      throw new StateError('not_found', `这本书没有第 ${index + 1} 章`, { field: 'chapter' });
    }
    return found;
  }

  asset(bookId: string, key: string): { data: Buffer; type: string } {
    if (!ASSET_KEY_PATTERN.test(key)) {
      throw new StateError('not_found', `没有插图 ${key}`);
    }
    const image = this.content(bookId).images.find((entry) => entry.key === key);
    if (image === undefined) {
      throw new StateError('not_found', `这本书里没有插图 ${key}`);
    }
    return { data: readFileSync(join(this.folderFor(bookId), ASSETS_DIRECTORY, key)), type: image.mime };
  }

  /** 原文件：以后换解析方式时从这里重新转一遍。 */
  source(bookId: string): Buffer {
    const folder = this.folderFor(bookId);
    const name = readdirSync(folder).find((entry) => entry.startsWith(`${SOURCE_BASENAME}.`));
    if (name === undefined) {
      throw new StateError('not_found', `书 ${bookId} 的原文件不在了`);
    }
    return readFileSync(join(folder, name));
  }
}
