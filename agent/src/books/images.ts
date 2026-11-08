// Images found in a book. The bytes decide the type, not the file name or manifest: MOBI image records sit next to
// font and index records, and EPUB manifests are often wrong about media types.

export interface ParsedImage {
  /** Matches [A-Za-z0-9_-]{1,64}; unique within one book. */
  key: string;
  mime: string;
  bytes: Buffer;
}

// One picture above 10 MB is almost always an unoptimized scan; the reader would stall on it (task brief).
export const IMAGE_MAX_BYTES = 10 * 1024 * 1024;

// Raster formats a browser shows in <img>. SVG is left out on purpose: served from our origin it could run script.
const SIGNATURES: Array<{ mime: string; matches: (bytes: Buffer) => boolean }> = [
  { mime: 'image/jpeg', matches: (bytes) => bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff },
  { mime: 'image/png', matches: (bytes) => bytes.subarray(0, 8).equals(Buffer.from('\x89PNG\r\n\x1a\n', 'latin1')) },
  { mime: 'image/gif', matches: (bytes) => bytes.subarray(0, 4).toString('latin1') === 'GIF8' },
  {
    mime: 'image/webp',
    matches: (bytes) => bytes.subarray(0, 4).toString('latin1') === 'RIFF'
      && bytes.subarray(8, 12).toString('latin1') === 'WEBP',
  },
  { mime: 'image/bmp', matches: (bytes) => bytes.subarray(0, 2).toString('latin1') === 'BM' },
];

export function sniffImageMime(bytes: Buffer): string | null {
  return SIGNATURES.find((signature) => signature.matches(bytes))?.mime ?? null;
}

/**
 * Hands out stable keys for image references (an EPUB path, a MOBI record number). Loading happens once per
 * reference; references that are missing, too large or not an image get no key and are dropped from the chapter.
 */
export class ImageCollector {
  readonly #load: (reference: string) => Buffer | null;
  readonly #keys = new Map<string, string | null>();
  readonly #images = new Map<string, ParsedImage>();

  constructor(load: (reference: string) => Buffer | null) {
    this.#load = load;
  }

  keyFor(reference: string): string | null {
    const known = this.#keys.get(reference);
    if (known !== undefined) {
      return known;
    }
    const bytes = this.#load(reference);
    const mime = bytes === null || bytes.length > IMAGE_MAX_BYTES ? null : sniffImageMime(bytes);
    let key: string | null = null;
    if (bytes !== null && mime !== null) {
      key = `img-${this.#images.size + 1}`;
      this.#images.set(key, { key, mime, bytes });
    }
    this.#keys.set(reference, key);
    return key;
  }

  image(key: string): ParsedImage | null {
    return this.#images.get(key) ?? null;
  }
}
