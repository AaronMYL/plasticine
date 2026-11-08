// EPUB 2 and 3: container.xml → OPF (metadata, manifest, spine) → chapters in spine order, titles from the EPUB 3
// nav document or the EPUB 2 NCX, the cover from the manifest, and DRM detected from META-INF/encryption.xml.

import { posix } from 'node:path';
import { firstHeading } from './blocks.ts';
import { decodeMarkup } from './decode.ts';
import { cleanMetadata, joinAuthors } from './draft.ts';
import type { DraftBook, DraftChapter } from './draft.ts';
import { BOOK_MESSAGES, BookParseError, corrupt } from './errors.ts';
import { ImageCollector } from './images.ts';
import { tokenize } from './markup.ts';
import { normalizeMarkup } from './normalize.ts';
import type { ImageResolver } from './normalize.ts';
import { attribute, findAll, findFirst, parseTree, textContent } from './tree.ts';
import type { MarkupElement } from './tree.ts';
import { readZip } from './zip.ts';
import type { ZipArchive } from './zip.ts';

// Font obfuscation (IDPF and Adobe) only scrambles embedded fonts; the text stays readable, so it is not DRM.
const FONT_OBFUSCATION = new Set(['http://www.idpf.org/2008/embedding', 'http://ns.adobe.com/pdf/enc#RC']);
const PACKAGE_MEDIA_TYPE = 'application/oebps-package+xml';
const NCX_MEDIA_TYPE = 'application/x-dtbncx+xml';
const CHAPTER_MEDIA_TYPES = new Set(['application/xhtml+xml', 'text/html', 'application/xml', 'text/xml']);
const CHAPTER_EXTENSION = /\.x?html?$/i;
const URL_SCHEME = /^[a-z][a-z0-9+.-]*:/i;
const DATA_URL = /^data:image\/[a-z0-9.+-]+;base64,/i;

interface ManifestItem {
  id: string;
  path: string;
  mediaType: string;
  properties: Set<string>;
}

function readTree(zip: ZipArchive, path: string): MarkupElement | null {
  const bytes = zip.read(path);
  return bytes === null ? null : parseTree(decodeMarkup(bytes));
}

/** Resolves an href inside the book to a ZIP path; null for links out of the book or to the same document. */
export function resolveHref(baseDirectory: string, href: string): string | null {
  const withoutFragment = href.trim().split('#')[0]?.split('?')[0] ?? '';
  if (withoutFragment.length === 0 || URL_SCHEME.test(withoutFragment)) {
    return null;
  }
  let decoded = withoutFragment;
  try {
    decoded = decodeURIComponent(withoutFragment);
  } catch (error) {
    // A bare "%" in a file name is not an escape; the href is then used as written.
    if (!(error instanceof URIError)) {
      throw error;
    }
  }
  const joined = decoded.startsWith('/') ? decoded.slice(1) : posix.join(baseDirectory, decoded);
  const normalized = posix.normalize(joined);
  if (normalized.startsWith('../') || normalized === '..') {
    return null;
  }
  return normalized.replace(/^\.\//, '');
}

function checkEncryption(zip: ZipArchive): void {
  const tree = readTree(zip, 'META-INF/encryption.xml');
  for (const data of findAll(tree, 'encrypteddata')) {
    const method = findFirst(data, 'encryptionmethod');
    const algorithm = method === null ? undefined : attribute(method, 'algorithm');
    if (algorithm === undefined || !FONT_OBFUSCATION.has(algorithm.trim())) {
      throw new BookParseError('drm', BOOK_MESSAGES.drm);
    }
  }
}

function packagePath(zip: ZipArchive): string {
  const rootfiles = findAll(readTree(zip, 'META-INF/container.xml'), 'rootfile');
  const preferred = rootfiles.find((rootfile) => attribute(rootfile, 'media-type') === PACKAGE_MEDIA_TYPE);
  for (const rootfile of [preferred, ...rootfiles]) {
    const path = rootfile === undefined ? undefined : attribute(rootfile, 'full-path');
    if (path !== undefined && zip.read(path) !== null) {
      return path;
    }
  }
  // Some hand-made books ship a broken container.xml; an OPF anywhere in the archive is still the package.
  const fallback = zip.names().find((name) => name.toLowerCase().endsWith('.opf'));
  if (fallback === undefined) {
    throw corrupt(new Error('no OPF package document'));
  }
  return fallback;
}

function readManifest(opf: MarkupElement, base: string): Map<string, ManifestItem> {
  const manifest = new Map<string, ManifestItem>();
  for (const item of findAll(findFirst(opf, 'manifest'), 'item')) {
    const id = attribute(item, 'id');
    const href = attribute(item, 'href');
    const path = href === undefined ? null : resolveHref(base, href);
    if (id === undefined || path === null) {
      continue;
    }
    const properties = new Set((attribute(item, 'properties') ?? '').split(/\s+/).filter((word) => word !== ''));
    manifest.set(id, { id, path, mediaType: (attribute(item, 'media-type') ?? '').toLowerCase(), properties });
  }
  return manifest;
}

function tocFromNav(zip: ZipArchive, item: ManifestItem, titles: Map<string, string>): void {
  const navs = findAll(readTree(zip, item.path), 'nav');
  const toc = navs.find((nav) => (attribute(nav, 'type') ?? '').split(/\s+/).includes('toc')) ?? navs[0];
  const directory = posix.dirname(item.path);
  for (const link of findAll(toc, 'a')) {
    const target = resolveHref(directory, attribute(link, 'href') ?? '');
    const title = cleanMetadata(textContent(link));
    if (target !== null && title !== null && !titles.has(target)) {
      titles.set(target, title);
    }
  }
}

function tocFromNcx(zip: ZipArchive, item: ManifestItem, titles: Map<string, string>): void {
  const directory = posix.dirname(item.path);
  for (const point of findAll(readTree(zip, item.path), 'navpoint')) {
    const title = cleanMetadata(textContent(findFirst(findFirst(point, 'navlabel'), 'text')));
    const content = findFirst(point, 'content');
    const target = content === null ? null : resolveHref(directory, attribute(content, 'src') ?? '');
    if (target !== null && title !== null && !titles.has(target)) {
      titles.set(target, title);
    }
  }
}

/** Chapter titles by document path: the first TOC entry pointing into each document wins. */
function readToc(zip: ZipArchive, manifest: Map<string, ManifestItem>, spine: MarkupElement): Map<string, string> {
  const titles = new Map<string, string>();
  const items = [...manifest.values()];
  const nav = items.find((item) => item.properties.has('nav'));
  if (nav !== undefined) {
    tocFromNav(zip, nav, titles);
  }
  const ncx = manifest.get(attribute(spine, 'toc') ?? '') ?? items.find((item) => item.mediaType === NCX_MEDIA_TYPE);
  if (titles.size === 0 && ncx !== undefined) {
    tocFromNcx(zip, ncx, titles);
  }
  return titles;
}

function coverReference(opf: MarkupElement, manifest: Map<string, ManifestItem>, base: string): string | null {
  const flagged = [...manifest.values()].find((item) => item.properties.has('cover-image'));
  if (flagged !== undefined) {
    return flagged.path;
  }
  const meta = findAll(findFirst(opf, 'metadata'), 'meta').find((element) => attribute(element, 'name') === 'cover');
  const content = meta === undefined ? undefined : attribute(meta, 'content');
  if (content === undefined) {
    return null;
  }
  // The content should be a manifest id; some tools write the image path there instead.
  return manifest.get(content)?.path ?? resolveHref(base, content);
}

function loadImage(zip: ZipArchive, reference: string): Buffer | null {
  if (DATA_URL.test(reference)) {
    return Buffer.from(reference.slice(reference.indexOf(',') + 1), 'base64');
  }
  try {
    return zip.read(reference);
  } catch (error) {
    // A damaged picture should cost that picture, not the whole book; DRM and the rest still propagate.
    if (error instanceof BookParseError && error.code === 'corrupt') {
      return null;
    }
    throw error;
  }
}

function imageResolver(images: ImageCollector, documentPath: string): ImageResolver {
  const directory = posix.dirname(documentPath);
  return (attributes) => {
    const source = attributes.get('src') ?? attributes.get('xlink:href') ?? attributes.get('href');
    if (source === undefined) {
      return null;
    }
    const trimmed = source.trim();
    const reference = DATA_URL.test(trimmed) ? trimmed : resolveHref(directory, trimmed);
    return reference === null ? null : images.keyFor(reference);
  };
}

/** Spine documents that hold reading text; the nav document is the table of contents the reader already shows. */
function isChapter(item: ManifestItem): boolean {
  if (item.properties.has('nav')) {
    return false;
  }
  return CHAPTER_MEDIA_TYPES.has(item.mediaType) || (item.mediaType === '' && CHAPTER_EXTENSION.test(item.path));
}

export function parseEpub(bytes: Buffer): DraftBook {
  const zip = readZip(bytes);
  checkEncryption(zip);
  const opfPath = packagePath(zip);
  const opf = readTree(zip, opfPath);
  const spine = findFirst(opf, 'spine');
  const itemrefs = findAll(spine, 'itemref');
  if (opf === null || spine === null || itemrefs.length === 0) {
    throw corrupt(new Error('OPF has no spine'));
  }
  const base = posix.dirname(opfPath);
  const manifest = readManifest(opf, base);
  const titles = readToc(zip, manifest, spine);
  const images = new ImageCollector((reference) => loadImage(zip, reference));
  const coverPath = coverReference(opf, manifest, base);
  let coverKey = coverPath === null ? null : images.keyFor(coverPath);
  const chapters: DraftChapter[] = [];
  itemrefs.forEach((itemref, index) => {
    const item = manifest.get(attribute(itemref, 'idref') ?? '');
    const content = item === undefined || !isChapter(item) ? null : zip.read(item.path);
    if (item === undefined || content === null) {
      return;
    }
    const document = normalizeMarkup(tokenize(decodeMarkup(content)), imageResolver(images, item.path));
    const looksLikeCover = index === 0 && /cover/i.test(`${item.id} ${item.path}`);
    if (coverKey === null && looksLikeCover) {
      coverKey = document.imageKeys[0] ?? null;
    }
    const title = titles.get(item.path) ?? firstHeading(document.blocks);
    chapters.push({ title, blocks: document.blocks, imageKeys: document.imageKeys });
  });
  const metadata = findFirst(opf, 'metadata');
  return {
    format: 'epub',
    title: cleanMetadata(textContent(findFirst(metadata, 'title'))),
    author: joinAuthors(findAll(metadata, 'creator').map(textContent)),
    language: cleanMetadata(textContent(findFirst(metadata, 'language'))),
    coverKey,
    chapters,
    images,
  };
}
