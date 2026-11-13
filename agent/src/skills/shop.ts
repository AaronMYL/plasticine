// 技能从外面来的三条路（技能页的「添加」，11-13）：
// - 商店：公开仓库 skills-store/ 里的一份清单（index.json）和每个技能的目录。11-13 Aaron 弹框选「公开仓库里放一份清单」：
//   不用新服务器、不改中继。先读 raw.githubusercontent.com，读不到换 jsDelivr 的镜像（国内的机器前者常连不上）。
// - 网址：GitHub 上的一个技能目录（…/tree/<分支>/<路径>）或者直接指到一份 SKILL.md。
// - 文件：他自己挑的一组文字文件。
// 三条路都先变成「一组文件」，校验过（有 SKILL.md、名字合规、只有文字、不超量）才给看、才装。读外面的网址都走
// PublicFetcher：不带身份、不读内网、限时限量。读来的内容只当资料（装上以后也只是方法，不是指令）。

import { Value } from 'typebox/value';
import { SkillStoreIndexSchema, SKILL_UPLOAD_MAX_CHARS, SKILL_UPLOAD_MAX_FILES, type SkillOrigin, type SkillPreview,
  type StoreSkill } from '../../shared/api/skills.ts';
import { SKILL_NAME_PATTERN } from '../../shared/skills.ts';
import { PublicFetcher, PublicFetchError, type PublicFetchOptions } from '../cloud-tools/public-fetch.ts';
import type { SkillFiles } from './files.ts';
import { hasScripts, skillMetadata, skillPath, skillTitle } from './format.ts';

export const SKILL_STORE_REPO = 'AaronMYL/plasticine';
const STORE_ROOTS = [
  `https://raw.githubusercontent.com/${SKILL_STORE_REPO}/main/skills-store`,
  `https://cdn.jsdelivr.net/gh/${SKILL_STORE_REPO}@main/skills-store`,
] as const;
const INDEX_CACHE_MS = 10 * 60_000;
const TIMEOUT_MS = 12_000;
const FILE_MAX_BYTES = 512 * 1024;
const USER_AGENT = 'Plasticine-skills';

/** 用户看得懂的一句原因；界面直接显示。 */
export class SkillShopError extends Error {
  readonly code: 'unreachable' | 'invalid' | 'not_found';
  constructor(code: 'unreachable' | 'invalid' | 'not_found', message: string) {
    super(message);
    this.name = 'SkillShopError';
    this.code = code;
  }
}

export interface SkillShopOptions extends PublicFetchOptions {
  /** 测试换掉读网址的那一步：给网址回文字，读不到抛错。 */
  fetchText?: (url: string, signal: AbortSignal) => Promise<string>;
  now?: () => number;
}

/** 一组要装的文件（已校验）和它从哪来。 */
export interface SkillBundle {
  name: string;
  files: SkillFiles;
  origin: string;
}

const encode = (text: string): string => Buffer.from(text).toString('base64');

/** GitHub 上的一个目录：https://github.com/<人>/<仓库>/tree/<分支>/<路径>。不是这个样子回 null。 */
export function githubTree(url: string): { repo: string; ref: string; path: string } | null {
  const matched = /^https:\/\/github\.com\/([\w.-]+\/[\w.-]+)\/tree\/([^/]+)\/(.+?)\/?$/.exec(url.trim());
  return matched === null ? null : { repo: matched[1]!, ref: matched[2]!, path: matched[3]! };
}

/** 指到一份 SKILL.md 的网址：GitHub 的 blob 页面换成原文地址，别的原样。不是指到 SKILL.md 的回 null。 */
export function skillFileUrl(url: string): string | null {
  const trimmed = url.trim();
  if (!/\/SKILL\.md(?:\?.*)?$/.test(trimmed)) { return null; }
  const blob = /^https:\/\/github\.com\/([\w.-]+\/[\w.-]+)\/blob\/([^/]+)\/(.+)$/.exec(trimmed);
  return blob === null ? trimmed : `https://raw.githubusercontent.com/${blob[1]}/${blob[2]}/${blob[3]}`;
}

/** 一组文字文件 → 校验过的技能包；不合规抛 SkillShopError（原因是给人看的）。 */
export function bundleOf(files: ReadonlyArray<{ path: string; content: string }>, origin: string): SkillBundle {
  if (files.length > SKILL_UPLOAD_MAX_FILES) {
    throw new SkillShopError('invalid', `一个技能最多 ${SKILL_UPLOAD_MAX_FILES} 个文件。`);
  }
  // 挑的是一个文件夹时，路径都带着文件夹名：去掉这一层。
  const paths = files.map((file) => file.path.replaceAll('\\', '/').replace(/^\.?\//, ''));
  const head = paths.find((path) => /(^|\/)SKILL\.md$/.test(path));
  if (head === undefined) {
    throw new SkillShopError('invalid', '这里面没有 SKILL.md，不是一个技能。');
  }
  const prefix = head.slice(0, head.length - 'SKILL.md'.length);
  const bundle: SkillFiles = {};
  for (const [index, file] of files.entries()) {
    const path = paths[index]!;
    if (!path.startsWith(prefix)) { continue; }
    if (file.content.length > SKILL_UPLOAD_MAX_CHARS || file.content.includes('\0')) {
      throw new SkillShopError('invalid', `「${path}」太大或者不是文字文件，装不了。`);
    }
    try {
      bundle[skillPath(path.slice(prefix.length))] = encode(file.content);
    } catch {
      throw new SkillShopError('invalid', `「${path}」这个路径不能放进技能里。`);
    }
  }
  const document = files[paths.indexOf(head)]!.content;
  const named = /^name:\s*(\S+)\s*$/m.exec(document)?.[1] ?? '';
  if (!new RegExp(SKILL_NAME_PATTERN).test(named)) {
    throw new SkillShopError('invalid', 'SKILL.md 开头要写 name（小写字母、数字、连字符）和 description。');
  }
  try {
    skillMetadata(document, named);
  } catch (cause) {
    throw new SkillShopError('invalid', cause instanceof Error ? cause.message : 'SKILL.md 的格式不对。');
  }
  return { name: named, files: bundle, origin };
}

export function previewOf(bundle: SkillBundle, installed: boolean): SkillPreview {
  const text = Buffer.from(bundle.files['SKILL.md'] ?? '', 'base64').toString('utf8');
  const { name, description } = skillMetadata(text, bundle.name);
  const files = Object.keys(bundle.files).sort();
  return { name, title: skillTitle(text), description, text, files, scripts: hasScripts(files), installed };
}

export class SkillShop {
  readonly #fetchText: (url: string, signal: AbortSignal) => Promise<string>;
  readonly #now: () => number;
  #index: { at: number; skills: StoreSkill[] } | null = null;

  constructor(options: SkillShopOptions = {}) {
    const fetcher = new PublicFetcher(options);
    this.#fetchText = options.fetchText ?? (async (url, signal) => (await fetcher.get(url, {
      accept: 'text/plain, application/json, */*', types: null, maxBytes: FILE_MAX_BYTES, timeoutMs: TIMEOUT_MS,
      userAgent: USER_AGENT }, signal)).data.toString('utf8'));
    this.#now = options.now ?? (() => Date.now());
  }

  /** 商店清单（缓存十分钟）；两个地址都读不到抛 unreachable。 */
  async catalog(signal: AbortSignal): Promise<StoreSkill[]> {
    if (this.#index !== null && this.#now() - this.#index.at < INDEX_CACHE_MS) {
      return this.#index.skills;
    }
    const text = await this.#fromStore('index.json', signal);
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new SkillShopError('invalid', '商店的清单读到了，但格式不对。');
    }
    if (!Value.Check(SkillStoreIndexSchema, parsed)) {
      throw new SkillShopError('invalid', '商店的清单读到了，但格式不对。');
    }
    this.#index = { at: this.#now(), skills: parsed.skills };
    return parsed.skills;
  }

  /** 把「从哪添加」变成一组校验过的文件。 */
  async bundle(from: SkillOrigin, signal: AbortSignal): Promise<SkillBundle> {
    if (from.kind === 'files') {
      return bundleOf(from.files, 'files');
    }
    if (from.kind === 'store') {
      const entry = (await this.catalog(signal)).find((skill) => skill.name === from.name);
      if (entry === undefined) {
        throw new SkillShopError('not_found', '商店里没有这个技能了。');
      }
      const files = [];
      for (const path of entry.files) {
        files.push({ path, content: await this.#fromStore(`${entry.name}/${path}`, signal) });
      }
      const bundle = bundleOf(files, `store:${entry.name}`);
      if (bundle.name !== entry.name) {
        throw new SkillShopError('invalid', '商店里这个技能的名字对不上，没有装。');
      }
      return bundle;
    }
    return this.#fromUrl(from.url, signal);
  }

  async #fromStore(path: string, signal: AbortSignal): Promise<string> {
    for (const root of STORE_ROOTS) {
      try {
        return await this.#fetchText(`${root}/${path}`, signal);
      } catch (cause) {
        if (signal.aborted) { throw cause; }
      }
    }
    throw new SkillShopError('unreachable', '现在连不上技能商店（GitHub），稍后再试；也可以用「从网址」「从文件」。');
  }

  async #fromUrl(raw: string, signal: AbortSignal): Promise<SkillBundle> {
    const url = raw.trim();
    const tree = githubTree(url);
    try {
      if (tree !== null) {
        return bundleOf(await this.#githubFiles(tree, signal), `url:${url}`);
      }
      const file = skillFileUrl(url);
      if (file === null) {
        throw new SkillShopError('invalid', '网址要指到 GitHub 上的一个技能目录（…/tree/…），或者直接指到一份 SKILL.md。');
      }
      return bundleOf([{ path: 'SKILL.md', content: await this.#fetchText(file, signal) }], `url:${url}`);
    } catch (cause) {
      if (cause instanceof SkillShopError || signal.aborted) { throw cause; }
      throw new SkillShopError('unreachable', cause instanceof PublicFetchError ? `这个网址没读到：${cause.message}`
        : '这个网址没读到，核对一下再试。');
    }
  }

  /** GitHub 目录里的文字文件（用它的目录接口列，只下一层子目录以内、不超量）。 */
  async #githubFiles(tree: { repo: string; ref: string; path: string }, signal: AbortSignal)
    : Promise<Array<{ path: string; content: string }>> {
    const listing: unknown = JSON.parse(await this.#fetchText(
      `https://api.github.com/repos/${tree.repo}/git/trees/${encodeURIComponent(tree.ref)}?recursive=1`, signal));
    const entries = typeof listing === 'object' && listing !== null && Array.isArray(Reflect.get(listing, 'tree'))
      ? Reflect.get(listing, 'tree') as unknown[] : [];
    const prefix = `${tree.path.replace(/\/$/, '')}/`;
    const paths = entries.flatMap((entry) => {
      const path: unknown = typeof entry === 'object' && entry !== null ? Reflect.get(entry, 'path') : undefined;
      const type: unknown = typeof entry === 'object' && entry !== null ? Reflect.get(entry, 'type') : undefined;
      return typeof path === 'string' && type === 'blob' && path.startsWith(prefix) ? [path] : [];
    });
    if (paths.length === 0) {
      throw new SkillShopError('not_found', '这个目录里没有文件，核对一下网址。');
    }
    if (paths.length > SKILL_UPLOAD_MAX_FILES) {
      throw new SkillShopError('invalid', `这个目录里有 ${paths.length} 个文件，一个技能最多 ${SKILL_UPLOAD_MAX_FILES} 个。`);
    }
    const files = [];
    for (const path of paths) {
      files.push({ path: path.slice(prefix.length), content: await this.#fetchText(
        `https://raw.githubusercontent.com/${tree.repo}/${tree.ref}/${path}`, signal) });
    }
    return files;
  }
}
