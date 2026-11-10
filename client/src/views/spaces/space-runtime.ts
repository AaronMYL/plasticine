// 空间网页 iframe 里的那一小段运行时（第 8 批第 6 条）：和外面的 Plasticine 用 postMessage 说话。
// iframe 是沙盒（只给 allow-scripts，不同源），拿不到 Plasticine 的 cookie，也连不了网（connect-src 'none'），所以：
// - 字体（Geist、霞鹜文楷按用到的字分片）和插图由外面读好，按字节传进来，这里用 FontFace / blob 地址装上；
// - 深浅色切换时外面传新的令牌值；
// - 链接点了交给外面（站外的在 Plasticine 网页标签里开；#/… 和 data-link="类别:id" 是 Plasticine 自己的页面）；
// - ✎ 改字：外面说进入，这里把能改的那几段变成可编辑，改了（停一下或离开这一段）把那一段交回去，Esc 收起；
// - 目录跟着滚动高亮、点了滚过去；分段控件（.seg button[data-filter]）筛同一节里带 data-tags 的卡片。
// 整个函数原样转成字符串放进 srcdoc：不许用外面的变量和导入，也不能用类型以外的 TypeScript 语法。

export type SpaceFrameMode = 'page' | 'thumb';

/** iframe 发给外面的话。 */
export type SpaceFrameOut =
  | { pz: 'space'; type: 'ready'; wenkai: string; assets: string[] }
  | { pz: 'space'; type: 'open'; url: string; title: string }
  | { pz: 'space'; type: 'navigate'; hash: string }
  | { pz: 'space'; type: 'link'; kind: string; id: string }
  | { pz: 'space'; type: 'edited'; index: number; html: string }
  | { pz: 'space'; type: 'escape' }
  | { pz: 'space'; type: 'selection'; text: string; sectionId: string | null; paragraph: number;
      left: number; top: number; bottom: number }
  | { pz: 'space'; type: 'key'; key: string; meta: boolean; ctrl: boolean; shift: boolean; alt: boolean };

export interface SpaceFontFace {
  family: string;
  data: ArrayBuffer;
  weight: string;
  unicodeRange?: string;
}

/** 外面发给 iframe 的话。 */
export type SpaceFrameIn =
  | { pz: 'space'; type: 'fonts'; faces: SpaceFontFace[] }
  | { pz: 'space'; type: 'asset'; src: string; data: ArrayBuffer; mime: string }
  | { pz: 'space'; type: 'theme'; vars: Record<string, string>; dark: boolean }
  | { pz: 'space'; type: 'edit'; on: boolean }
  | { pz: 'space'; type: 'clear-selection' }
  | { pz: 'space'; type: 'highlight'; paragraph: number }
  /** 外面挂上监听晚了（页面先载完了）：再说一遍「准备好了」。 */
  | { pz: 'space'; type: 'hello' };

export function spaceRuntime(mode: SpaceFrameMode): void {
  const SAVE_AFTER_MS = 800;
  const REVEAL_AFTER_MS = 600;
  const WENKAI_SELECTOR = '.lt-title,.lt-fig figcaption,.lt-sign,.wk';
  const post = (message: Record<string, unknown>): void => {
    window.parent.postMessage({ pz: 'space', ...message }, '*');
  };
  const reveal = (): void => {
    document.body.classList.remove('pz-wait');
  };
  const pending = new Map<number, number>();
  let editing = false;
  let readyMessage: Record<string, unknown> | null = null;

  const flush = (element: HTMLElement): void => {
    const index = Number(element.dataset['e']);
    const timer = pending.get(index);
    if (timer === undefined) return;
    window.clearTimeout(timer);
    pending.delete(index);
    post({ type: 'edited', index, html: element.innerHTML });
  };
  const flushAll = (): void => {
    document.querySelectorAll<HTMLElement>('[data-e]').forEach((element) => flush(element));
  };
  const setEditing = (on: boolean): void => {
    if (on === editing) return;
    if (!on) flushAll();
    editing = on;
    document.body.classList.toggle('pz-editing', on);
    document.querySelectorAll<HTMLElement>('[data-e]').forEach((element) => {
      if (on) element.setAttribute('contenteditable', 'plaintext-only');
      else element.removeAttribute('contenteditable');
    });
    if (!on && document.activeElement instanceof HTMLElement) document.activeElement.blur();
  };

  const applyTheme = (vars: Record<string, string>, dark: boolean): void => {
    const root = document.documentElement;
    for (const [name, value] of Object.entries(vars)) root.style.setProperty(name, value);
    root.style.colorScheme = dark ? 'dark' : 'light';
  };

  const loadFonts = (faces: { family: string; data: ArrayBuffer; weight: string; unicodeRange?: string }[]): void => {
    const loads = faces.map((face) => {
      const descriptors: FontFaceDescriptors = { weight: face.weight };
      if (face.unicodeRange !== undefined) descriptors.unicodeRange = face.unicodeRange;
      const font = new FontFace(face.family, face.data, descriptors);
      document.fonts.add(font);
      return font.load();
    });
    void Promise.allSettled(loads).then(reveal);
  };

  const showAsset = (src: string, data: ArrayBuffer, mime: string): void => {
    const url = URL.createObjectURL(new Blob([data], { type: mime }));
    document.querySelectorAll<HTMLImageElement>('img[data-pz-asset]').forEach((image) => {
      if (image.dataset['pzAsset'] === src) image.src = url;
    });
  };

  const scrollToId = (id: string): void => {
    const target = document.getElementById(id);
    if (target !== null) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const onClick = (event: MouseEvent): void => {
    const target = event.target instanceof Element ? event.target : null;
    const filter = target?.closest<HTMLElement>('.seg button[data-filter]') ?? null;
    if (filter !== null && !editing) {
      const group = filter.closest('.seg');
      const scope = filter.closest('section,[data-filter-scope]') ?? document.body;
      const value = filter.dataset['filter'] ?? '*';
      group?.querySelectorAll('button[data-filter]').forEach((button) => button.classList.toggle('on',
        button === filter));
      scope.querySelectorAll<HTMLElement>('[data-tags]').forEach((item) => {
        const tags = (item.dataset['tags'] ?? '').split(/[\s,，]+/);
        item.toggleAttribute('data-filter-hidden', value !== '*' && !tags.includes(value));
      });
      return;
    }
    const anchor = target?.closest<HTMLAnchorElement>('a[href],a[data-link]') ?? null;
    if (anchor === null) return;
    event.preventDefault();
    // 改字时点在正在改的字里的链接是放光标，不跳；目录这类不能改的照常。
    if (mode === 'thumb' || (editing && anchor.closest('[data-e]') !== null)) return;
    const link = anchor.dataset['link'];
    const href = anchor.getAttribute('href') ?? '';
    if (link !== undefined) {
      const split = link.indexOf(':');
      if (split > 0) post({ type: 'link', kind: link.slice(0, split), id: link.slice(split + 1) });
    } else if (href.startsWith('#/')) {
      post({ type: 'navigate', hash: href });
    } else if (href.startsWith('#')) {
      scrollToId(decodeURIComponent(href.slice(1)));
    } else if (/^(https?:|mailto:)/i.test(href)) {
      post({ type: 'open', url: href, title: (anchor.textContent ?? '').trim() });
    }
  };

  const watchToc = (): void => {
    const links = [...document.querySelectorAll<HTMLAnchorElement>('.rp-toc a[href^="#"]')];
    if (links.length === 0 || typeof IntersectionObserver === 'undefined') return;
    const byId = new Map(links.map((link) => [decodeURIComponent((link.getAttribute('href') ?? '').slice(1)), link]));
    const visible = new Set<string>();
    const mark = (): void => {
      const first = [...byId.keys()].find((id) => visible.has(id));
      if (first === undefined) return;
      byId.forEach((link, id) => link.classList.toggle('on', id === first));
    };
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) visible.add(entry.target.id);
        else visible.delete(entry.target.id);
      }
      mark();
    }, { rootMargin: '0px 0px -55% 0px' });
    byId.forEach((_link, id) => {
      const section = document.getElementById(id);
      if (section !== null) observer.observe(section);
    });
  };

  const onInput = (event: Event): void => {
    const element = event.target instanceof HTMLElement ? event.target.closest<HTMLElement>('[data-e]') : null;
    if (element === null || !editing) return;
    const index = Number(element.dataset['e']);
    const timer = pending.get(index);
    if (timer !== undefined) window.clearTimeout(timer);
    pending.set(index, window.setTimeout(() => flush(element), SAVE_AFTER_MS));
  };

  const onKey = (event: KeyboardEvent): void => {
    if (event.key === 'Escape' && editing) {
      event.preventDefault();
      flushAll();
      post({ type: 'escape' });
      return;
    }
    if (event.key === 'Enter' && editing && !event.isComposing) {
      // 一段就是一段：回车不拆段，交给「完成」或点别处。
      event.preventDefault();
      return;
    }
    if ((event.metaKey || event.ctrlKey) && !editing) {
      post({ type: 'key', key: event.key, meta: event.metaKey, ctrl: event.ctrlKey, shift: event.shiftKey,
        alt: event.altKey });
    }
  };

  const onSelection = (): void => {
    if (mode === 'thumb') return;
    const selection = window.getSelection();
    const text = editing ? '' : selection?.toString().trim() ?? '';
    if (text === '' || selection === null || selection.rangeCount === 0) {
      post({ type: 'selection', text: '', paragraph: 0, sectionId: null, left: 0, top: 0, bottom: 0 });
      return;
    }
    const range = selection.getRangeAt(0);
    const start = range.startContainer instanceof Element ? range.startContainer : range.startContainer.parentElement;
    const paragraph = start?.closest<HTMLElement>('[data-qp]')
      ?? [...document.querySelectorAll<HTMLElement>('[data-qp]')].find((element) => range.intersectsNode(element));
    if (paragraph === undefined || paragraph === null) return;
    const rect = range.getBoundingClientRect();
    post({ type: 'selection', text, paragraph: Number(paragraph.dataset['qp']),
      sectionId: paragraph.closest('section[id]')?.id ?? null, left: rect.left, top: rect.top, bottom: rect.bottom });
  };

  window.addEventListener('message', (event: MessageEvent) => {
    if (event.source !== window.parent) return;
    const data: unknown = event.data;
    if (typeof data !== 'object' || data === null || Reflect.get(data, 'pz') !== 'space') return;
    const type: unknown = Reflect.get(data, 'type');
    if (type === 'fonts') loadFonts(Reflect.get(data, 'faces') as never);
    else if (type === 'asset') {
      showAsset(String(Reflect.get(data, 'src')), Reflect.get(data, 'data') as ArrayBuffer,
        String(Reflect.get(data, 'mime')));
    } else if (type === 'theme') {
      applyTheme(Reflect.get(data, 'vars') as Record<string, string>, Reflect.get(data, 'dark') === true);
    } else if (type === 'edit') setEditing(Reflect.get(data, 'on') === true);
    else if (type === 'clear-selection') window.getSelection()?.removeAllRanges();
    else if (type === 'highlight') {
      const paragraph = Number(Reflect.get(data, 'paragraph'));
      const target = Number.isInteger(paragraph)
        ? document.querySelector<HTMLElement>(`[data-qp="${paragraph}"]`) : null;
      if (target !== null) {
        document.querySelector('[data-pz-highlight]')?.removeAttribute('data-pz-highlight');
        target.setAttribute('data-pz-highlight', '');
        const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        target.scrollIntoView({ block: 'center', behavior: reduced ? 'instant' : 'smooth' });
      }
    }
    else if (type === 'hello' && readyMessage !== null) post(readyMessage);
  });

  document.addEventListener('DOMContentLoaded', () => {
    document.addEventListener('click', onClick);
    document.addEventListener('input', onInput);
    document.addEventListener('focusout', (event) => {
      if (event.target instanceof HTMLElement && event.target.dataset['e'] !== undefined) flush(event.target);
    });
    document.addEventListener('keydown', onKey);
    document.addEventListener('selectionchange', onSelection);
    document.addEventListener('scroll', onSelection, { passive: true });
    document.addEventListener('paste', (event) => {
      if (!editing) return;
      event.preventDefault();
      const text = event.clipboardData?.getData('text/plain') ?? '';
      document.execCommand('insertText', false, text.replace(/\s*\n\s*/g, ' '));
    });
    watchToc();
    const wenkai = new Set<string>();
    document.querySelectorAll(WENKAI_SELECTOR).forEach((element) => {
      for (const char of element.textContent ?? '') wenkai.add(char);
    });
    const assets = [...document.querySelectorAll<HTMLImageElement>('img[data-pz-asset]')]
      .map((image) => image.dataset['pzAsset'] ?? '').filter((src) => src !== '');
    readyMessage = { type: 'ready', wenkai: [...wenkai].join(''), assets: [...new Set(assets)] };
    post(readyMessage);
    window.setTimeout(reveal, REVEAL_AFTER_MS);
  });
}
