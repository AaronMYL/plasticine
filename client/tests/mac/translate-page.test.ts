import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  TRANSLATE_ASK_MAX_CHARS, TRANSLATE_BATCH_MAX_CHARS, TRANSLATE_BATCH_MAX_ITEMS, TRANSLATE_ITEM_MAX_CHARS,
  TranslatePageMessageSchema,
} from '../../src/api/shared.ts';
import { installPageTranslator, type TranslatorHost, type TranslatorOutbound } from '../../src/mac/translate-page.ts';
import { alreadyTarget, candidatesIn, PAGE_LIMITS } from '../../src/mac/translate-page-rules.ts';
import { Value } from 'typebox/value';

const ARTICLE = `
<header><nav><a href="/">Field Notes</a> <a href="/archive">Archive</a> <a href="/about">About</a></nav></header>
<main><article>
  <header><h1 id="title">What a personal agent should remember</h1><p id="meta">November 2, 2026 · 9 min read</p></header>
  <p id="p1">Most agents forget everything the moment a conversation ends. The usual fix is a bigger memory.</p>
  <h2 id="h2">Remember decisions, not transcripts</h2>
  <p id="p2">A useful memory looks less like a <a href="/r">recording</a> and more like a notebook.</p>
  <ul><li id="li">Keep what you decided and who is involved.</li></ul>
  <table><tbody><tr><td id="td">Store everything forever</td><td id="num">42</td></tr></tbody></table>
  <blockquote id="quote"><p id="qp">If it is not sure you said it, it should ask.</p></blockquote>
  <figure><img alt=""><figcaption id="cap">A notebook someone keeps for you.</figcaption></figure>
  <pre><code>const memory = new Store();</code></pre>
  <p id="zh">这一段已经是中文了，不用再译。</p>
  <form><label>Your name <input id="field" value="secret typed text"></label>
    <textarea>draft reply that must stay private</textarea><button>Send it now</button></form>
  <div contenteditable="true"><p>Editable words are not page text.</p></div>
  <p aria-hidden="true">Hidden from readers entirely.</p>
</article></main>
<footer><p>Copyright notice for the whole site.</p></footer>`;

type Where = 'visible' | 'ahead' | null;

function fakeHost(where: (element: Element) => Where = () => 'visible') {
  const posts: TranslatorOutbound[] = [];
  const timers = new Set<() => void>();
  const watched = new Set<Element>();
  let enter: (element: Element, at: 'visible' | 'ahead') => void = () => undefined;
  let clock = 1_000;
  const host: TranslatorHost = {
    document,
    post: (message) => posts.push(message),
    now: () => clock,
    schedule(callback) {
      timers.add(callback);
      return () => timers.delete(callback);
    },
    where,
    watcher(onEnter) {
      enter = onEnter;
      return { watch: (element) => watched.add(element), unwatch: (element) => watched.delete(element),
        disconnect: () => watched.clear() };
    },
  };
  const flush = (): void => {
    for (const callback of [...timers]) {
      timers.delete(callback);
      callback();
    }
  };
  return { host, posts, watched, flush, enter: (element: Element, at: 'visible' | 'ahead') => enter(element, at),
    tick: (ms: number) => { clock += ms; } };
}

function requests(posts: TranslatorOutbound[]) {
  return posts.flatMap((post) => (post.type === 'request' ? [post] : []));
}

function byId(id: string): HTMLElement {
  const element = document.getElementById(id);
  if (element === null) {
    throw new Error(`页面上没有 #${id}`);
  }
  return element;
}

const config = { run: 'run-1', target: 'zh-CN' as const, display: 'bilingual' as const };

afterEach(() => {
  document.body.innerHTML = '';
  document.querySelectorAll('[data-plasticine-translate], plasticine-toolbar').forEach((node) => node.remove());
});

describe('切段', () => {
  it('正文段落、标题、列表项、表格格、引用、图注要译；导航、页头页脚、表单、代码、可编辑区、藏起来的、已经是中文的不译', () => {
    document.body.innerHTML = ARTICLE;
    const ids = candidatesIn(document.body).map((element) => element.id);
    expect(ids).toEqual(['title', 'meta', 'p1', 'h2', 'p2', 'li', 'td', 'qp', 'cap', 'zh']);
    expect(alreadyTarget('这一段已经是中文了，不用再译。', 'zh-CN', '')).toBe(true);
    expect(alreadyTarget('Most agents forget everything.', 'zh-CN', 'en')).toBe(false);
    expect(alreadyTarget('Bonjour tout le monde', 'fr', 'fr-FR')).toBe(true);
    expect(alreadyTarget('This is the kind of text that is in English.', 'en', '')).toBe(true);
  });

  it('切段的上限和服务端一致', () => {
    expect(PAGE_LIMITS).toEqual({ batchItems: TRANSLATE_BATCH_MAX_ITEMS, batchChars: TRANSLATE_BATCH_MAX_CHARS,
      itemChars: TRANSLATE_ITEM_MAX_CHARS, askChars: TRANSLATE_ASK_MAX_CHARS });
  });
});

describe('翻译一页', () => {
  it('首屏的先送（visible），下一屏的后送（ahead）；只发段落文字，输入框里填的字一个都不发', () => {
    document.body.innerHTML = ARTICLE;
    const below = new Set(['li', 'td', 'qp', 'cap']);
    const fake = fakeHost((element) => (below.has(element.id) ? 'ahead' : 'visible'));
    const translator = installPageTranslator(fake.host);
    expect(fake.posts[0]).toEqual({ type: 'page', url: document.location.href, blocked: false });
    expect(translator.start(config)).toBe(true);
    fake.flush();
    const sent = requests(fake.posts);
    expect(sent.map((request) => request.priority)).toEqual(['visible', 'ahead']);
    expect(sent[0]?.items.map((item) => item.text)).toContain('Remember decisions, not transcripts');
    expect(sent[0]?.items).toHaveLength(5);
    expect(sent[1]?.items).toHaveLength(4);
    const everything = JSON.stringify(fake.posts);
    for (const secret of ['secret typed text', 'draft reply', 'Send it now', 'Editable words', 'Hidden from readers',
      'Copyright', 'Archive', 'const memory']) {
      expect(everything).not.toContain(secret);
    }
    for (const post of fake.posts) {
      expect(Value.Check(TranslatePageMessageSchema, post)).toBe(true);
    }
  });

  it('没回来的段先放灰条（标题一条、短段两条、长段三条），回来换成译文；首屏全回来时报一次首屏毫秒数', () => {
    document.body.innerHTML = '<h1 id="t">A short title here</h1><p id="a">A short paragraph of text.</p>'
      + `<p id="b">${'A much longer paragraph that goes on. '.repeat(6)}</p><p id="c">Far below the fold here.</p>`;
    const fake = fakeHost((element) => (element.id === 'c' ? null : 'visible'));
    const translator = installPageTranslator(fake.host);
    translator.start(config);
    fake.flush();
    const bars = (id: string) => byId(id).querySelectorAll('plasticine-tr[data-state="pending"] plasticine-bar').length;
    expect([bars('t'), bars('a'), bars('b')]).toEqual([1, 2, 3]);
    expect(byId('c').querySelector('plasticine-tr')).toBeNull();
    expect(fake.watched.has(byId('c'))).toBe(true);
    const [request] = requests(fake.posts);
    const ids = request!.items.map((item) => item.id);
    fake.tick(1_800);
    translator.apply({ run: 'run-1', items: [{ id: ids[0]!, text: '一个短标题' }, { id: ids[1]!, text: '一小段话。' }],
      failed: [] });
    const progressBefore = fake.posts.filter((post) => post.type === 'progress').at(-1);
    expect(progressBefore).toMatchObject({ pending: 1, done: 2, firstScreenMs: null });
    translator.apply({ run: 'run-1', items: [{ id: ids[2]!, text: '一长段。' }], failed: [] });
    const node = byId('a').querySelector('plasticine-tr');
    expect(node?.textContent).toBe('一小段话。');
    expect(node?.getAttribute('data-state')).toBe('done');
    expect(node?.getAttribute('lang')).toBe('zh-CN');
    expect(byId('t').querySelector('plasticine-tr')?.hasAttribute('data-heading')).toBe(true);
    expect(fake.posts.filter((post) => post.type === 'progress').at(-1))
      .toMatchObject({ pending: 0, done: 3, failed: 0, firstScreenMs: 1_800 });
  });

  it('没译成的段落去掉灰条、原文不动，段尾留一个小重试标记，点了只重要这一段；别的一轮的译文不认', () => {
    document.body.innerHTML = '<p id="a">First paragraph of the page.</p><p id="b">Second paragraph of the page.</p>';
    const fake = fakeHost();
    const translator = installPageTranslator(fake.host);
    translator.start(config);
    fake.flush();
    const ids = requests(fake.posts)[0]!.items.map((item) => item.id);
    translator.apply({ run: 'run-0', items: [{ id: ids[0]!, text: '旧一轮的' }], failed: [] });
    expect(byId('a').querySelector('plasticine-tr')?.getAttribute('data-state')).toBe('pending');
    translator.apply({ run: 'run-1', items: [], failed: ids });
    expect(byId('a').querySelector('plasticine-bar')).toBeNull();
    expect(byId('a').querySelector('plasticine-tr')?.getAttribute('data-state')).toBe('failed');
    expect(byId('a').textContent).toBe('First paragraph of the page.');
    expect(fake.posts.at(-1)).toMatchObject({ type: 'progress', failed: 2, pending: 0 });
    const mark = byId('a').querySelector<HTMLElement>('plasticine-retry')!;
    expect(mark.getAttribute('role')).toBe('button');
    expect(mark.getAttribute('aria-label')).toBe('没译成，点一下重试');
    mark.click();
    expect(requests(fake.posts).at(-1)).toMatchObject({ priority: 'visible', fresh: false,
      items: [{ id: ids[0], text: 'First paragraph of the page.' }] });
    expect(byId('a').querySelector('plasticine-tr')?.getAttribute('data-state')).toBe('pending');
    expect(fake.posts.at(-1)).toMatchObject({ type: 'progress', failed: 1, pending: 1 });
    translator.apply({ run: 'run-1', items: [{ id: ids[0]!, text: '页面的第一段。' }], failed: [] });
    expect(byId('a').querySelector('plasticine-tr')?.textContent).toBe('页面的第一段。');
  });

  it('同一轮再配置一次：没译成的段落全部重新排队', () => {
    document.body.innerHTML = '<p id="a">First paragraph of the page.</p><p id="b">Second paragraph of the page.</p>';
    const fake = fakeHost();
    const translator = installPageTranslator(fake.host);
    translator.start(config);
    fake.flush();
    const ids = requests(fake.posts)[0]!.items.map((item) => item.id);
    translator.apply({ run: 'run-1', items: [{ id: ids[0]!, text: '页面的第一段。' }], failed: [ids[1]!] });
    expect(translator.start(config)).toBe(true);
    expect(fake.posts.at(-1)).toMatchObject({ type: 'progress', pending: 1, done: 1, failed: 0 });
    fake.flush();
    expect(requests(fake.posts).at(-1)?.items).toEqual([{ id: ids[1], text: 'Second paragraph of the page.' }]);
    expect(byId('b').querySelector('plasticine-tr')?.getAttribute('data-state')).toBe('pending');
    expect(byId('a').querySelector('plasticine-tr')?.textContent).toBe('页面的第一段。');
  });

  it('开翻时第一批还没发出去就报在等几段，不报 0', () => {
    document.body.innerHTML = '<p id="a">First paragraph of the page.</p><p id="b">Second paragraph of the page.</p>';
    const fake = fakeHost();
    installPageTranslator(fake.host).start(config);
    expect(requests(fake.posts)).toHaveLength(0);
    expect(fake.posts.at(-1)).toMatchObject({ type: 'progress', pending: 2, done: 0, failed: 0 });
  });

  it('开 → 关 → 再开（三轮）：关掉逐字还原；再开先插回记住的译文，没译完的才再要', () => {
    document.body.innerHTML = ARTICLE;
    const original = document.body.innerHTML;
    const fake = fakeHost();
    const translator = installPageTranslator(fake.host);
    translator.start(config);
    fake.flush();
    const first = requests(fake.posts)[0]!;
    const finished = first.items.slice(0, 3);
    translator.apply({ run: 'run-1', items: finished.map((item) => ({ id: item.id, text: `译：${item.text}` })),
      failed: [] });
    translator.stop();
    expect(document.body.innerHTML).toBe(original);
    const before = requests(fake.posts).length;
    translator.start({ ...config, run: 'run-2' });
    expect(byId('title').querySelector('plasticine-tr')?.textContent).toBe('译：What a personal agent should remember');
    expect(byId('title').querySelector('plasticine-tr')?.getAttribute('data-state')).toBe('done');
    fake.flush();
    const again = requests(fake.posts).slice(before);
    const asked = again.flatMap((request) => request.items.map((item) => item.text));
    expect(asked).toEqual(first.items.slice(3).map((item) => item.text));
    expect(again.every((request) => request.run === 'run-2')).toBe(true);
    translator.stop();
    expect(document.body.innerHTML).toBe(original);
    translator.start({ ...config, run: 'run-3' });
    expect(byId('p1').querySelector('plasticine-tr')?.textContent).toMatch(/^译：Most agents/);
    translator.stop();
    expect(document.body.innerHTML).toBe(original);
  });

  it('换了目标语言不拿记住的另一种语言的译文', () => {
    document.body.innerHTML = '<p id="a">First paragraph of the page.</p>';
    const fake = fakeHost();
    const translator = installPageTranslator(fake.host);
    translator.start(config);
    fake.flush();
    const id = requests(fake.posts)[0]!.items[0]!.id;
    translator.apply({ run: 'run-1', items: [{ id, text: '页面的第一段。' }], failed: [] });
    translator.start({ ...config, run: 'run-2', target: 'ja' });
    fake.flush();
    expect(byId('a').querySelector('plasticine-tr')?.getAttribute('data-state')).toBe('pending');
    expect(requests(fake.posts).at(-1)).toMatchObject({ run: 'run-2',
      items: [{ text: 'First paragraph of the page.' }] });
  });

  it('只看译文：原文藏起、悬停看原文；切回双语对照、关掉都原样还原', () => {
    document.body.innerHTML = ARTICLE;
    const original = document.body.innerHTML;
    const fake = fakeHost();
    const translator = installPageTranslator(fake.host);
    translator.start({ ...config, display: 'translation' });
    fake.flush();
    const sent = requests(fake.posts)[0]!;
    translator.apply({ run: 'run-1', items: sent.items.map((item) => ({ id: item.id, text: `译：${item.text}` })),
      failed: [] });
    const p1 = byId('p1');
    expect(p1.hasAttribute('data-plasticine-only')).toBe(true);
    expect(p1.querySelector('plasticine-tr')?.getAttribute('title')).toBe(p1.firstChild?.textContent?.trim());
    translator.start(config);
    expect(p1.hasAttribute('data-plasticine-only')).toBe(false);
    expect(p1.querySelector('plasticine-tr')?.textContent).toMatch(/^译：Most agents/);
    translator.stop();
    expect(document.body.innerHTML).toBe(original);
    expect(document.querySelector('style[data-plasticine-translate]')).toBeNull();
    expect(translator.running()).toBeNull();
  });

  it('一屏段落多时按每批上限分几批送', () => {
    document.body.innerHTML = Array.from({ length: 30 }, (_, index) => `<p>Paragraph number ${index} of many.</p>`)
      .join('');
    const fake = fakeHost();
    installPageTranslator(fake.host).start(config);
    fake.flush();
    expect(requests(fake.posts).map((request) => request.items.length)).toEqual([24, 6]);
  });

  it('页面上有卡号框（付款）就不开翻，报这一页不能翻', () => {
    document.body.innerHTML = '<p>Pay for your order now please.</p><input autocomplete="cc-number">';
    const fake = fakeHost();
    const translator = installPageTranslator(fake.host);
    expect(fake.posts[0]).toMatchObject({ type: 'page', blocked: true });
    expect(translator.start(config)).toBe(false);
    fake.flush();
    expect(requests(fake.posts)).toHaveLength(0);
  });
});

describe('一直加载的页面', () => {
  it('新冒出来的段落接着切，进到视口就送；译过的段落字变了就重译', async () => {
    document.body.innerHTML = '<div id="feed"><article><div id="t1" lang="en">First post on the timeline.</div>'
      + '</article></div>';
    const fake = fakeHost();
    const translator = installPageTranslator(fake.host);
    translator.start(config);
    fake.flush();
    const first = requests(fake.posts)[0]!;
    translator.apply({ run: 'run-1', items: [{ id: first.items[0]!.id, text: '时间线上第一条。' }], failed: [] });
    const fresh = document.createElement('article');
    fresh.innerHTML = '<div id="t2" lang="en"><span>Second post </span><span>arrived later.</span></div>';
    byId('feed').appendChild(fresh);
    byId('t1').firstChild!.nodeValue = 'First post, edited by its author.';
    await Promise.resolve();
    fake.flush();
    expect(fake.watched.has(byId('t2'))).toBe(true);
    expect(fake.watched.has(byId('t1'))).toBe(true);
    expect(byId('t1').querySelector('plasticine-tr')).toBeNull();
    fake.enter(byId('t2'), 'visible');
    fake.enter(byId('t1'), 'visible');
    fake.flush();
    const later = requests(fake.posts).at(-1)!;
    expect(later.items.map((item) => item.text)).toEqual(['Second post arrived later.', 'First post, edited by its author.']);
  });
});

describe('悬停工具条', () => {
  it('悬停译文出工具条：重译不用缓存、复制交给原生、问这一段带原文和译文', () => {
    let shadow: ShadowRoot | null = null;
    const attach = Element.prototype.attachShadow;
    vi.spyOn(Element.prototype, 'attachShadow').mockImplementation(function (this: Element, init) {
      shadow = attach.call(this, { ...init, mode: 'open' });
      return shadow;
    });
    document.body.innerHTML = '<p id="a">Most agents forget everything.</p>';
    const fake = fakeHost();
    const translator = installPageTranslator(fake.host);
    translator.start(config);
    fake.flush();
    const id = requests(fake.posts)[0]!.items[0]!.id;
    translator.apply({ run: 'run-1', items: [{ id, text: '大多数 agent 什么都会忘。' }], failed: [] });
    const node = byId('a').querySelector('plasticine-tr')!;
    node.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    const bar = document.querySelector('plasticine-toolbar');
    expect(bar?.hasAttribute('data-open')).toBe(true);
    const button = (name: string) => shadow!.querySelector<HTMLButtonElement>(`button[title="${name}"]`)!;
    expect(shadow!.querySelector('[role="toolbar"]')?.getAttribute('aria-label')).toBe('译文');
    button('复制译文').click();
    expect(fake.posts.at(-1)).toEqual({ type: 'copy', text: '大多数 agent 什么都会忘。' });
    node.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    button('问这一段').click();
    expect(fake.posts.at(-1)).toMatchObject({ type: 'ask', source: 'Most agents forget everything.',
      translation: '大多数 agent 什么都会忘。' });
    node.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    button('重译').click();
    const again = requests(fake.posts).at(-1)!;
    expect(again).toMatchObject({ fresh: true, priority: 'visible', items: [{ id, text: 'Most agents forget everything.' }] });
    expect(byId('a').querySelector('plasticine-tr')?.getAttribute('data-state')).toBe('pending');
    translator.stop();
    expect(document.querySelector('plasticine-toolbar')).toBeNull();
  });
});
