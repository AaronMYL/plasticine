// 沉浸式翻译注入网页标签的脚本（Mac 0.4.0，第 2 批）。Mac 原生层把它作为 WKUserScript 注入每个网页标签的独立脚本世界
// （页面自己的脚本碰不到这里的函数），scripts/generate-translate-script.ts 把这一份和
// translate-page-rules.ts（切段规则）、translate-page-look.ts（样子、工具条和重试标记）、translate-page-host.ts
// （浏览器里的外部能力）去掉类型拼起来，生成 Mac 和 iPhone 的 translate-page-script.swift。四份之间的 import 拼的时候
// 抹掉，所以只引这四份和 import type。
//
// 做什么：切段（正文段落、标题、列表项、表格格、引用、图注……；跳过导航、页头页脚、按钮、输入框、代码、可编辑区、隐藏的、
// 已经是目标语言的）→ 视口里的先送、往下一屏的后送（IntersectionObserver）→ 新冒出来的内容接着切（MutationObserver，
// X 这种一直加载的页面）→ 没回来的先放两三条灰条 → 回来换成译文（双语对照：原文下面一段，左边 1px 细线、字色跟页面走、
// 略淡，标题的译文跟着大；只看译文：原文藏起，悬停看原文）→ 关掉全部还原。悬停译文出小工具条：重译、复制、问这一段。
// 没译成的段落原文不动，段尾留一个小重试标记；同一轮再配置一次（网页界面的「重试」）把没译成的全部重新排队。
// 关掉时按（目标语言、原文）记住已有的译文，再开先直接插回，缺的才再要（2026-11-04 修「开 → 关 → 再开不翻了」）：
// 记在脚本里，不经原生层和网页界面、不占并发，零往返；换了文档脚本重装、记的跟着没，那时服务端缓存兜底。
// 设备不调模型：段落经原生层交给网页界面，网页界面调 /v2/translate，译文再经原生层送回 apply()。只读页面上的字，
// 不读输入框里填的内容；页面上有卡号框（付款）就不开翻。

import type { TranslateDelivery, TranslatePageConfig, TranslatePageMessage, TranslatePriority }
  from '../api/shared.ts';
import { createRetryMark, createToolbar, STYLE } from './translate-page-look.ts';
import { alreadyTarget, CARD_FIELDS, candidatesIn, clip, HEADING_TAGS, INLINE_TAGS, langOf, PAGE_LIMITS, sourceText }
  from './translate-page-rules.ts';

/** 脚本发给原生层的消息：报给网页界面的四种，加一个原生自己处理的「复制」。 */
export type TranslatorOutbound = TranslatePageMessage | { type: 'copy'; text: string };

// 等新内容停一停再切（X 往下滚一次会冒出好几批节点）；送段落也攒一下，免得一段一个请求。
const MUTATION_SETTLE_MS = 250;
const FLUSH_MS = 30;
// 一份文档最多记这么多段译文：一篇长文几百段，一直加载的时间线滚一晚上也就上千段；超了先忘最早的。
const REMEMBER_MAX = 2_000;

export interface ViewportWatcher {
  watch(element: Element): void;
  unwatch(element: Element): void;
  disconnect(): void;
}

/** 脚本用到的外部能力：浏览器里用 browserHost（translate-page-host.ts），测试换成假的（jsdom 没有布局）。 */
export interface TranslatorHost {
  document: Document;
  post(message: TranslatorOutbound): void;
  now(): number;
  schedule(callback: () => void, ms: number): () => void;
  /** 现在在不在视口里：visible = 看得见，ahead = 往下一屏以内，null = 更远或没画出来。 */
  where(element: Element): TranslatePriority | null;
  /** 进到视口或往下一屏以内时回调一次。 */
  watcher(onEnter: (element: Element, where: TranslatePriority) => void): ViewportWatcher;
}

type SegmentState = 'idle' | 'pending' | 'done' | 'failed';

interface Segment {
  id: string;
  element: Element;
  source: string;
  heading: boolean;
  state: SegmentState;
  node: HTMLElement | null;
  translation: string | null;
  firstScreen: boolean;
  /** 进只看译文之前元素上的 style 属性（还原用）。 */
  styleBefore: string | null;
}

export interface PageTranslator {
  start(config: TranslatePageConfig): boolean;
  stop(): void;
  apply(delivery: TranslateDelivery): void;
  /** 测试和原生层看现在开着没有。 */
  running(): string | null;
}

export function installPageTranslator(host: TranslatorHost): PageTranslator {
  const doc = host.document;
  const nonce = Math.random().toString(36).slice(2, 8);
  let counter = 0;
  let config: TranslatePageConfig | null = null;
  let startedAt = 0;
  let firstScreenMs: number | null = null;
  let chars = 0;
  const segments = new Map<string, Segment>();
  const byElement = new Map<Element, Segment>();
  const queue: Record<TranslatePriority, Segment[]> = { visible: [], ahead: [] };
  /** 记住的译文：键是目标语言 + 原文，关掉不清，再开先从这里插回。 */
  const remembered = new Map<string, string>();
  let cancelFlush: (() => void) | null = null;
  let cancelSettle: (() => void) | null = null;
  let watcher: ViewportWatcher | null = null;
  let mutations: MutationObserver | null = null;
  let style: HTMLStyleElement | null = null;
  const toolbar = createToolbar(doc, host.schedule);

  host.post({ type: 'page', url: doc.location.href, blocked: doc.querySelector(CARD_FIELDS) !== null });

  function onOver(event: Event): void {
    const target = event.target instanceof Element ? event.target.closest('plasticine-tr') : null;
    const segment = target === null ? undefined : segments.get(target.getAttribute('data-plasticine-tr') ?? '');
    if (segment !== undefined && segment.state === 'done' && segment.node !== null) {
      const chosen = segment;
      toolbar.show(segment.node, { again: () => retranslate(chosen), copy: () => copy(chosen),
        ask: () => ask(chosen) }, config?.display === 'translation' ? chosen.source : undefined);
    }
  }

  function onOut(event: Event): void {
    const target = event.target instanceof Element ? event.target.closest('plasticine-tr') : null;
    if (target !== null) {
      toolbar.hideSoon();
    }
  }

  function progress(): void {
    if (config === null) {
      return;
    }
    const all = [...segments.values()];
    const first = all.filter((segment) => segment.firstScreen);
    if (firstScreenMs === null && first.length > 0
      && first.every((segment) => segment.state === 'done' || segment.state === 'failed')) {
      firstScreenMs = Math.max(0, Math.round(host.now() - startedAt));
      host.post({ type: 'progress', run: config.run, ...counts(all), chars, firstScreenMs });
      return;
    }
    host.post({ type: 'progress', run: config.run, ...counts(all), chars, firstScreenMs: null });
  }

  /** 排着还没发出去的也算在等：开翻时第一批发出前不报 0（不然网页界面会先当成都译完了）。 */
  function counts(all: Segment[]) {
    return {
      pending: all.filter((segment) => segment.state === 'pending').length + queue.visible.length
        + queue.ahead.length,
      done: all.filter((segment) => segment.state === 'done').length,
      failed: all.filter((segment) => segment.state === 'failed').length,
    };
  }

  function register(element: Element): Segment | null {
    if (byElement.has(element) || config === null) {
      return null;
    }
    const source = sourceText(element);
    if (alreadyTarget(source, config.target, langOf(element))) {
      return null;
    }
    counter += 1;
    const segment: Segment = { id: `${nonce}-${counter}`, element, source, heading: HEADING_TAGS.has(element.tagName),
      state: 'idle', node: null, translation: null, firstScreen: false, styleBefore: null };
    segments.set(segment.id, segment);
    byElement.set(element, segment);
    return segment;
  }

  function memoryKey(source: string): string {
    return `${config?.target ?? ''}\u0000${source}`;
  }

  function remember(segment: Segment, text: string): void {
    const key = memoryKey(segment.source);
    remembered.delete(key);
    remembered.set(key, text);
    if (remembered.size > REMEMBER_MAX) {
      const oldest = remembered.keys().next();
      if (oldest.done !== true) {
        remembered.delete(oldest.value);
      }
    }
  }

  /** 该译这一段了：记得译文就直接插回，不记得才排队送出去。 */
  function enqueue(segment: Segment, where: TranslatePriority): void {
    if (segment.state !== 'idle' || queue.visible.includes(segment) || queue.ahead.includes(segment)) {
      return;
    }
    watcher?.unwatch(segment.element);
    const known = remembered.get(memoryKey(segment.source));
    if (known !== undefined) {
      render(segment, known);
    } else {
      queue[where].push(segment);
    }
    // 插回的也攒一下再报进度（flush 队列空时只报进度）。
    if (cancelFlush === null) {
      cancelFlush = host.schedule(flush, FLUSH_MS);
    }
  }

  function placeholder(segment: Segment): HTMLElement {
    const node = segment.node ?? doc.createElement('plasticine-tr');
    node.setAttribute('data-plasticine-tr', segment.id);
    node.setAttribute('data-target', config?.target ?? '');
    node.setAttribute('data-state', 'pending');
    node.setAttribute('aria-busy', 'true');
    node.removeAttribute('title');
    if (segment.heading) {
      node.setAttribute('data-heading', '');
    }
    const bars = segment.heading ? 1 : segment.source.length < 160 ? 2 : 3;
    node.replaceChildren(...Array.from({ length: bars }, () => doc.createElement('plasticine-bar')));
    if (!node.isConnected) {
      segment.element.appendChild(node);
    }
    segment.node = node;
    waitMode(segment, config?.display === 'translation');
    return node;
  }

  function send(batch: Segment[], where: TranslatePriority, fresh: boolean): void {
    if (config === null || batch.length === 0) {
      return;
    }
    for (const segment of batch) {
      segment.state = 'pending';
      placeholder(segment);
      chars += Array.from(segment.source).length;
    }
    host.post({ type: 'request', run: config.run, url: doc.location.href, priority: where, fresh,
      items: batch.map((segment) => ({ id: segment.id, text: segment.source })) });
  }

  function flush(): void {
    cancelFlush = null;
    for (const where of ['visible', 'ahead'] as const) {
      let batch: Segment[] = [];
      let size = 0;
      for (const segment of queue[where].splice(0)) {
        const length = Array.from(segment.source).length;
        if (batch.length >= PAGE_LIMITS.batchItems || size + length > PAGE_LIMITS.batchChars) {
          send(batch, where, false);
          batch = [];
          size = 0;
        }
        batch.push(segment);
        size += length;
      }
      send(batch, where, false);
    }
    progress();
  }

  /** 只看译文时还没译到的段落：原文先留着、变淡（不出灰条），译好了原地换。 */
  function waitMode(segment: Segment, on: boolean): void {
    (segment.element as HTMLElement).toggleAttribute('data-plasticine-wait', on && segment.state !== 'done');
  }

  /**
   * 只看译文：原文的字号记成变量（译文照这个大小），元素标 data-plasticine-only（样式把原文藏起）。
   * 还原时连 style 属性一起还原：原来没有就去掉，不留一个空的 style=""。
   */
  function onlyMode(segment: Segment, on: boolean): void {
    const element = segment.element as HTMLElement;
    // 等着的样子只给「只看译文、正在等」的段落；译好了、没译成、换回双语对照都撤掉。
    element.toggleAttribute('data-plasticine-wait', on && segment.node?.getAttribute('data-state') === 'pending');
    if (on && segment.state === 'done') {
      if (!element.hasAttribute('data-plasticine-only')) {
        const computed = doc.defaultView?.getComputedStyle(element);
        segment.styleBefore = element.getAttribute('style');
        // 字号清零后按 em 算的外边距也跟着没了：原来的字号、行高、上下外边距都记成像素。
        element.style.setProperty('--plasticine-fs', computed?.fontSize || '16px');
        element.style.setProperty('--plasticine-lh', computed?.lineHeight || 'normal');
        element.style.setProperty('--plasticine-mt', computed?.marginTop || '0px');
        element.style.setProperty('--plasticine-mb', computed?.marginBottom || '0px');
      }
      element.setAttribute('data-plasticine-only', '');
      return;
    }
    if (!element.hasAttribute('data-plasticine-only')) {
      return;
    }
    element.removeAttribute('data-plasticine-only');
    for (const name of ['--plasticine-fs', '--plasticine-lh', '--plasticine-mt', '--plasticine-mb']) {
      element.style.removeProperty(name);
    }
    if (segment.styleBefore === null && element.getAttribute('style') === '') {
      element.removeAttribute('style');
    }
  }

  function render(segment: Segment, text: string): void {
    const node = segment.node ?? placeholder(segment);
    node.removeAttribute('aria-busy');
    node.setAttribute('data-state', 'done');
    node.setAttribute('lang', config?.target ?? '');
    node.replaceChildren(doc.createTextNode(text));
    segment.translation = text;
    segment.state = 'done';
    remember(segment, text);
    onlyMode(segment, config?.display === 'translation');
  }

  /** 没译成：灰条撤掉、原文不动，段尾留一个小重试标记，点了只重要这一段。 */
  function fail(segment: Segment): void {
    onlyMode(segment, false);
    const node = segment.node ?? doc.createElement('plasticine-tr');
    node.setAttribute('data-plasticine-tr', segment.id);
    node.setAttribute('data-state', 'failed');
    node.removeAttribute('aria-busy');
    node.replaceChildren(createRetryMark(doc, () => retryOne(segment)));
    if (!node.isConnected) {
      segment.element.appendChild(node);
    }
    segment.node = node;
    segment.translation = null;
    segment.state = 'failed';
  }

  function retryOne(segment: Segment): void {
    if (config === null || segment.state !== 'failed') {
      return;
    }
    segment.state = 'idle';
    send([segment], 'visible', false);
    progress();
  }

  /** 同一轮再配置一次：没译成的全部重新排队（记得译文的直接插回）。 */
  function retryFailed(): void {
    for (const segment of segments.values()) {
      if (segment.state === 'failed') {
        segment.state = 'idle';
        enqueue(segment, 'visible');
      }
    }
  }

  function reset(segment: Segment): void {
    onlyMode(segment, false);
    segment.node?.remove();
    segment.node = null;
    segment.translation = null;
    segment.state = 'idle';
  }

  function retranslate(segment: Segment): void {
    onlyMode(segment, false);
    segment.state = 'idle';
    send([segment], 'visible', true);
    progress();
  }

  function copy(segment: Segment): void {
    if (segment.translation !== null) {
      host.post({ type: 'copy', text: segment.translation });
    }
  }

  function ask(segment: Segment): void {
    host.post({ type: 'ask', url: doc.location.href, title: doc.title,
      source: clip(segment.source, PAGE_LIMITS.askChars), translation: clip(segment.translation ?? '',
        PAGE_LIMITS.askChars) });
  }

  function scan(root: Element): void {
    for (const element of candidatesIn(root)) {
      const segment = register(element);
      if (segment !== null) {
        watcher?.watch(element);
      }
    }
  }

  function ours(node: Node): boolean {
    const element = node.nodeType === 1 ? node as Element : node.parentElement;
    return element !== null && element.closest('plasticine-tr, plasticine-toolbar') !== null;
  }

  function segmentAround(node: Node): Segment | undefined {
    for (let element = node.nodeType === 1 ? node as Element : node.parentElement; element !== null;
      element = element.parentElement) {
      const segment = byElement.get(element);
      if (segment !== undefined) {
        return segment;
      }
    }
    return undefined;
  }

  /** 新冒出来的节点从哪儿重新切：块元素从它自己切；字和行内元素从装它的那个块切。 */
  function rootFor(node: Node, container: Node): Element | null {
    let element = node.nodeType === 1 && !INLINE_TAGS.has((node as Element).tagName) ? node as Element
      : container.nodeType === 1 ? container as Element : container.parentElement;
    while (element !== null && INLINE_TAGS.has(element.tagName)) {
      element = element.parentElement;
    }
    return element;
  }

  function settle(records: MutationRecord[]): void {
    const roots = new Set<Element>();
    const touched = new Set<Segment>();
    for (const record of records) {
      if (ours(record.target)) {
        continue;
      }
      const nodes = [...Array.from(record.addedNodes), ...Array.from(record.removedNodes)];
      if (record.type === 'childList' && nodes.length > 0 && nodes.every(ours)) {
        continue;
      }
      const segment = segmentAround(record.target);
      if (segment !== undefined) {
        touched.add(segment);
        continue;
      }
      for (const node of Array.from(record.addedNodes)) {
        const root = ours(node) ? null : rootFor(node, record.target);
        if (root !== null) {
          roots.add(root);
        }
      }
    }
    for (const segment of [...segments.values()]) {
      if (!segment.element.isConnected) {
        segments.delete(segment.id);
        byElement.delete(segment.element);
      }
    }
    for (const segment of touched) {
      const text = sourceText(segment.element);
      if (text !== segment.source && segment.element.isConnected) {
        reset(segment);
        segment.source = text;
        watcher?.watch(segment.element);
      }
    }
    for (const root of roots) {
      if (root.isConnected && segmentAround(root) === undefined) {
        scan(root);
      }
    }
    progress();
  }

  function start(next: TranslatePageConfig): boolean {
    if (doc.querySelector(CARD_FIELDS) !== null) {
      host.post({ type: 'page', url: doc.location.href, blocked: true });
      return false;
    }
    if (config !== null && config.run === next.run && config.target === next.target) {
      config = next;
      for (const segment of segments.values()) {
        onlyMode(segment, next.display === 'translation');
      }
      retryFailed();
      progress();
      return true;
    }
    if (config !== null) {
      stop();
    }
    config = next;
    startedAt = host.now();
    firstScreenMs = null;
    chars = 0;
    style = doc.createElement('style');
    style.setAttribute('data-plasticine-translate', '');
    style.textContent = STYLE;
    (doc.head ?? doc.documentElement).appendChild(style);
    watcher = host.watcher((element, where) => {
      const segment = byElement.get(element);
      if (segment !== undefined) {
        enqueue(segment, where);
      }
    });
    const body = doc.body;
    if (body !== null) {
      for (const element of candidatesIn(body)) {
        const segment = register(element);
        if (segment === null) {
          continue;
        }
        const where = host.where(element);
        segment.firstScreen = where === 'visible';
        if (where === null) {
          watcher.watch(element);
        } else {
          enqueue(segment, where);
        }
      }
      const view = doc.defaultView;
      if (view !== null && typeof view.MutationObserver === 'function') {
        mutations = new view.MutationObserver((records) => {
          cancelSettle?.();
          const pending = [...records];
          cancelSettle = host.schedule(() => { cancelSettle = null; settle(pending); }, MUTATION_SETTLE_MS);
        });
        mutations.observe(body, { childList: true, subtree: true, characterData: true });
      }
    }
    doc.addEventListener('mouseover', onOver, true);
    doc.addEventListener('mouseout', onOut, true);
    progress();
    return true;
  }

  function stop(): void {
    cancelFlush?.();
    cancelFlush = null;
    cancelSettle?.();
    cancelSettle = null;
    mutations?.disconnect();
    mutations = null;
    watcher?.disconnect();
    watcher = null;
    for (const segment of segments.values()) {
      reset(segment);
    }
    segments.clear();
    byElement.clear();
    queue.visible = [];
    queue.ahead = [];
    style?.remove();
    style = null;
    toolbar.remove();
    doc.removeEventListener('mouseover', onOver, true);
    doc.removeEventListener('mouseout', onOut, true);
    config = null;
  }

  function apply(delivery: TranslateDelivery): void {
    if (config === null || delivery.run !== config.run) {
      return;
    }
    for (const item of delivery.items) {
      const segment = segments.get(item.id);
      if (segment !== undefined && segment.state === 'pending' && item.text.trim() !== '') {
        render(segment, item.text);
      }
    }
    for (const id of delivery.failed) {
      const segment = segments.get(id);
      if (segment !== undefined && segment.state === 'pending') {
        fail(segment);
      }
    }
    progress();
  }

  return { start, stop, apply, running: () => config?.run ?? null };
}
