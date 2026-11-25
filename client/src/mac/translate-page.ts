import type { TranslateDelivery, TranslatePageConfig, TranslatePageMessage, TranslatePriority }
  from '../api/shared.ts';
import { createRetryMark, createToolbar, STYLE } from './translate-page-look.ts';
import { alreadyTarget, CARD_FIELDS, candidatesIn, clip, HEADING_TAGS, INLINE_TAGS, langOf, PAGE_LIMITS, sourceText }
  from './translate-page-rules.ts';

export type TranslatorOutbound = TranslatePageMessage | { type: 'copy'; text: string };

const MUTATION_SETTLE_MS = 250;
const FLUSH_MS = 30;
const REMEMBER_MAX = 2_000;

export interface ViewportWatcher {
  watch(element: Element): void;
  unwatch(element: Element): void;
  disconnect(): void;
}

export interface TranslatorHost {
  document: Document;
  post(message: TranslatorOutbound): void;
  now(): number;
  schedule(callback: () => void, ms: number): () => void;
  where(element: Element): TranslatePriority | null;
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
  styleBefore: string | null;
}

export interface PageTranslator {
  start(config: TranslatePageConfig): boolean;
  stop(): void;
  apply(delivery: TranslateDelivery): void;
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

  function waitMode(segment: Segment, on: boolean): void {
    (segment.element as HTMLElement).toggleAttribute('data-plasticine-wait', on && segment.state !== 'done');
  }

  function onlyMode(segment: Segment, on: boolean): void {
    const element = segment.element as HTMLElement;
    element.toggleAttribute('data-plasticine-wait', on && segment.node?.getAttribute('data-state') === 'pending');
    if (on && segment.state === 'done') {
      if (!element.hasAttribute('data-plasticine-only')) {
        const computed = doc.defaultView?.getComputedStyle(element);
        segment.styleBefore = element.getAttribute('style');
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
          cancelSettle = host.schedule(() => {
            cancelSettle = null;
            settle(pending);
          }, MUTATION_SETTLE_MS);
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
