// The files behind notes (《实施方案》第 4 节迁移规则 5): one Markdown file per note in the state directory's notes/,
// and the pictures notes refer to in notes/assets/. A write goes to a temporary file first and is renamed into
// place, so a crash leaves either the old text or the new one, never half of it. Nothing here deletes a body.

import { createHash, randomUUID } from 'node:crypto';
import { chmodSync, linkSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { NOTE_IMAGE_MAX_BYTES, NOTE_IMAGE_TYPES } from '../../shared/api/notes-workspace.ts';
import { StateError } from './errors.ts';

// Only the plasticine user reads notes (same modes as the old notebook).
const DIRECTORY_MODE = 0o700;
const FILE_MODE = 0o600;
const BODY_EXTENSION = '.md';
export const ASSETS_DIRECTORY = 'assets';
// Note ids come from state/ (UUIDs); this keeps a body file name from ever leaving the notes directory.
const NOTE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,99}$/;
/** Picture names the old notebook produced (`<16 hex>.png` …); no path separators, no leading dot. */
export const ASSET_NAME_PATTERN = /^[A-Za-z0-9_-][A-Za-z0-9_.-]{0,99}\.(png|jpe?g|gif|webp)$/i;
const ASSET_TYPES: Readonly<Record<string, string>> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
};

export interface BodyDigest {
  bytes: number;
  sha256: string;
}

export interface NoteAsset {
  data: Buffer;
  type: string;
}

export function digestOf(data: string | Buffer): BodyDigest {
  const buffer = typeof data === 'string' ? Buffer.from(data, 'utf8') : data;
  return { bytes: buffer.length, sha256: createHash('sha256').update(buffer).digest('hex') };
}

function isMissingFile(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}

export class NoteBodies {
  readonly #directory: string | undefined;

  constructor(directory: string | undefined) {
    this.#directory = directory;
  }

  /** The notes directory; a library opened without one (an in-memory test library) cannot hold notes. */
  get directory(): string {
    if (this.#directory === undefined) {
      throw new StateError('invalid_input', '这个库没有配置笔记目录，存不了笔记正文');
    }
    return this.#directory;
  }

  fileFor(noteId: string): string {
    if (!NOTE_ID_PATTERN.test(noteId)) {
      throw new StateError('invalid_input', `笔记编号 ${noteId} 不能用作文件名`, { field: 'id' });
    }
    return `${noteId}${BODY_EXTENSION}`;
  }

  /**
   * The body file of one saved version (review-followups e4cef52): every save writes a new file and the row's pointer
   * moves to it in the same transaction as the version, so a failed or refused save never leaves the old version
   * number on new text. The files of earlier versions stay; they are the note's history.
   */
  versionFileFor(noteId: string, version: number): string {
    if (!Number.isInteger(version) || version < 1) {
      throw new StateError('invalid_input', `笔记版本号 ${version} 不对`, { field: 'version' });
    }
    // An outer transaction may roll back after this file is written. A retry must never reuse or overwrite it.
    return `${this.fileFor(noteId).slice(0, -BODY_EXTENSION.length)}.v${version}.${randomUUID()}${BODY_EXTENSION}`;
  }

  /** `exclusive`: a version file is written once; one already there is never replaced. */
  write(file: string, markdown: string, exclusive = false): BodyDigest {
    const directory = this.directory;
    mkdirSync(directory, { recursive: true, mode: DIRECTORY_MODE });
    const target = join(directory, file);
    const temp = join(directory, `.${file}.${randomUUID()}.tmp`);
    const data = Buffer.from(markdown, 'utf8');
    try {
      writeFileSync(temp, data, { mode: FILE_MODE, flag: 'wx' });
      // The umask may have narrowed the create mode; set it exactly before the file becomes visible.
      chmodSync(temp, FILE_MODE);
      if (exclusive) {
        // link fails when the target exists, so an earlier version's file cannot be overwritten.
        linkSync(temp, target);
        rmSync(temp, { force: true });
      } else {
        renameSync(temp, target);
      }
    } catch (error) {
      rmSync(temp, { force: true });
      throw new Error(`写笔记正文 ${file} 失败`, { cause: error });
    }
    return digestOf(data);
  }

  read(file: string): string {
    return readFileSync(join(this.directory, file), 'utf8');
  }

  /** Byte count and SHA-256 of what is on disk now; undefined when the file is missing. */
  inspect(file: string): BodyDigest | undefined {
    try {
      return digestOf(readFileSync(join(this.directory, file)));
    } catch (error) {
      if (isMissingFile(error)) {
        return undefined;
      }
      throw error;
    }
  }

  /** Removes a body that was written for a row that never got stored; never called for a stored note. */
  discardUnstored(file: string): void {
    rmSync(join(this.directory, file), { force: true });
  }

  assetPath(name: string): string {
    if (!ASSET_NAME_PATTERN.test(name)) {
      throw new StateError('invalid_input', `图片名 ${name} 不认识`, { field: 'name' });
    }
    return join(this.directory, ASSETS_DIRECTORY, name);
  }

  writeAsset(data: Buffer, type: string): { name: string; bytes: number } {
    const index = (NOTE_IMAGE_TYPES as readonly string[]).indexOf(type);
    if (index === -1 || data.length === 0 || data.length > NOTE_IMAGE_MAX_BYTES) {
      throw new StateError('invalid_input', '请选择不超过 10 MB 的 PNG、JPEG、GIF 或 WebP 图片。');
    }
    const extensions = ['png', 'jpg', 'gif', 'webp'];
    const name = `${digestOf(data).sha256}.${extensions[index]}`;
    mkdirSync(join(this.directory, ASSETS_DIRECTORY), { recursive: true, mode: DIRECTORY_MODE });
    writeFileSync(this.assetPath(name), data, { mode: FILE_MODE });
    return { name, bytes: data.length };
  }

  readAsset(name: string): NoteAsset | undefined {
    const path = this.assetPath(name);
    const extension = name.slice(name.lastIndexOf('.') + 1).toLowerCase();
    const type = ASSET_TYPES[extension];
    if (type === undefined) {
      return undefined;
    }
    try {
      if (!statSync(path).isFile()) {
        return undefined;
      }
      return { data: readFileSync(path), type };
    } catch (error) {
      if (isMissingFile(error)) {
        return undefined;
      }
      throw error;
    }
  }
}
