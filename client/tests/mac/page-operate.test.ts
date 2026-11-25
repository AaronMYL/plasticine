import { Value } from 'typebox/value';
import { PagePerceptionSchema } from '../../../agent/shared/api/index.ts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OPERATE_DOT_COLOR, PAGE_OPERATE_SCRIPT } from '../../src/mac/page-operate.ts';

type Json = Record<string, unknown>;

async function run(request: Json): Promise<Json> {
  const body = new Function('request', `return (async () => {\n${PAGE_OPERATE_SCRIPT}\n})();`) as
    (input: Json) => Promise<string>;
  return JSON.parse(await body(request)) as Json;
}

interface Item { n: number; role: string; name: string; value?: string | null; submit?: string; password?: boolean }

async function perceive(): Promise<{ version: string; outline: string; elements: Item[] }> {
  return await run({ op: 'perceive' }) as unknown as { version: string; outline: string; elements: Item[] };
}

async function numberOf(name: string): Promise<{ version: string; n: number; item: Item }> {
  const page = await perceive();
  const item = page.elements.find((element) => element.name === name);
  if (item === undefined) {
    throw new Error(`页面上没有「${name}」：${page.elements.map((element) => element.name).join('、')}`);
  }
  return { version: page.version, n: item.n, item };
}

async function kindOf(name: string): Promise<string | null> {
  return (await numberOf(name)).item.submit ?? null;
}

const RACE = `
<h1>填写报名信息</h1>
<form id="race" action="/signup" method="post">
  <label>姓名 <input name="name" value="Alex"></label>
  <label for="phone">手机</label><input id="phone" name="phone">
  <label>组别 <select name="group"><option value="10k">10 公里</option><option value="half">半程马拉松</option></select></label>
  <label>密码 <input type="password" name="pwd"></label>
  <label>卡号 <input name="card" autocomplete="cc-number"></label>
  <label><input type="checkbox" name="agree"> 同意免责声明</label>
  <button type="button" id="next">下一步</button>
  <button>提交报名并支付 ¥180</button>
</form>
<p hidden><button>藏起来的按钮</button></p>
<a href="/rules">比赛规则</a>
<a href="https://news.example.com/launch">苹果发布会</a>
<a href="https://www.alipay.com/pay?id=1">去支付宝</a>
<a href="?page=2">下一页</a>`;

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  document.body.innerHTML = '';
  document.title = '';
  delete (window as { __plasticineOperate?: unknown }).__plasticineOperate;
});

describe('full-page perception', () => {
  it('numbers visible interactive elements in order, skips hidden ones, interleaves outline', async () => {
    document.title = '城市马拉松 · 报名';
    document.body.innerHTML = RACE;
    const page = await perceive();
    const names = page.elements.map((item) => item.name);
    expect(names.slice(0, 4)).toEqual(['姓名', '手机', '组别', '密码']);
    expect(names).not.toContain('藏起来的按钮');
    expect(page.elements[0]).toMatchObject({ n: 1, role: 'textbox', name: '姓名', value: 'Alex' });
    expect(page.elements[2]).toMatchObject({ role: 'combobox', value: '10 公里' });
    expect(page.outline).toContain('# 填写报名信息');
    expect(page.outline).toContain('[1 输入框「姓名」 = Alex]');
    expect(page.outline).toMatch(/\[\d+ 按钮「提交报名并支付 ¥180」 提交：付款\]/);
    expect(page.version).not.toBe('');
  });

  it('never returns password field values, only marks them as password inputs', async () => {
    document.body.innerHTML = '<form><input type="password" value="不该出现的字"><button>登录</button></form>';
    const page = await perceive();
    expect(page.elements[0]).toMatchObject({ password: true, value: null });
    expect(JSON.stringify(page)).not.toContain('不该出现的字');
  });
});

describe('detecting whether an action is a submission', () => {
  it('button text priority: payment > delete > settings > post/send; form submit is generic', async () => {
    document.body.innerHTML = `${RACE}
      <button>删除这条评论</button><button>保存设置</button><button>发布</button><button>发送</button>
      <div role="button">回复</div><button>Place order</button>
      <form><input name="title"><button type="submit">保存</button></form>
      <form><textarea name="body"></textarea><input type="submit" value="Go"></form>`;
    expect(await kindOf('提交报名并支付 ¥180')).toBe('pay');
    expect(await kindOf('Place order')).toBe('pay');
    expect(await kindOf('删除这条评论')).toBe('delete');
    expect(await kindOf('保存设置')).toBe('settings');
    expect(await kindOf('发布')).toBe('publish');
    expect(await kindOf('发送')).toBe('publish');
    expect(await kindOf('回复')).toBe('publish');
    expect(await kindOf('保存')).toBe('submit');
    expect(await kindOf('Go')).toBe('submit');
  });

  it('read, navigate, paginate, and form fill controls do not count as submissions', async () => {
    document.body.innerHTML = `${RACE}
      <form role="search"><input name="q"><button>搜索</button></form>
      <form method="get"><input name="wd"><button>百度一下</button></form>
      <form method="post"><input name="user"><input type="password" name="p"><button>登录</button></form>
      <button>展开全文</button>`;
    for (const name of ['比赛规则', '苹果发布会', '下一页', '下一步', '同意免责声明', '姓名', '搜索', '百度一下', '登录',
      '展开全文']) {
      expect(await kindOf(name), name).toBeNull();
    }
  });

  it('links or form submissions targeting payment host or path count as payment', async () => {
    document.body.innerHTML = `${RACE}<a href="/checkout/123">结算页</a>
      <form action="https://pay.example.com/cashier"><button>好</button></form>`;
    expect(await kindOf('去支付宝')).toBe('pay');
    expect(await kindOf('结算页')).toBe('pay');
    expect(await kindOf('好')).toBe('pay');
  });
});

describe('element actions by number', () => {
  it('non-submit click executes, moves spotlight via --run to target, pauses, then hides', async () => {
    document.body.innerHTML = RACE;
    const clicked = vi.fn();
    document.getElementById('next')!.addEventListener('click', clicked);
    const { version, n } = await numberOf('下一步');
    const result = await run({ op: 'act', version, act: { op: 'click', n }, allowSubmit: false });
    expect(result).toMatchObject({ ok: true, op: 'click', target: { n, name: '下一步' }, submitted: null });
    vi.advanceTimersByTime(1);
    expect(clicked).toHaveBeenCalledTimes(1);
    const dot = document.querySelector<HTMLElement>('plasticine-dot');
    expect(dot).not.toBeNull();
    expect(dot!.getAttribute('aria-hidden')).toBe('true');
    expect(dot!.style.background.toLowerCase()).toMatch(/#5a6b85|rgb\(90, 107, 133\)/);
    expect(OPERATE_DOT_COLOR).toBe('#5A6B85');
    vi.advanceTimersByTime(10_000);
    expect(document.querySelector('plasticine-dot')).toBeNull();
  });

  it('unapproved submit is blocked and returns kind and label; approved submit clicks', async () => {
    document.body.innerHTML = RACE;
    const submitted = vi.fn((event: Event) => event.preventDefault());
    document.getElementById('race')!.addEventListener('submit', submitted);
    const { version, n } = await numberOf('提交报名并支付 ¥180');
    const refused = await run({ op: 'act', version, act: { op: 'click', n }, allowSubmit: false });
    expect(refused).toMatchObject({ ok: false, error: 'submit', submit: { kind: 'pay', label: '提交报名并支付 ¥180' } });
    vi.runOnlyPendingTimers();
    expect(submitted).not.toHaveBeenCalled();
    const allowed = await run({ op: 'act', version, act: { op: 'click', n }, allowSubmit: true });
    expect(allowed).toMatchObject({ ok: true, submitted: 'pay' });
    vi.runOnlyPendingTimers();
    expect(submitted).toHaveBeenCalledTimes(1);
  });

  it('pressing Enter in input always requires confirmation even if styled like search', async () => {
    document.body.innerHTML = `${RACE}<form role="search"><input name="q" aria-label="搜索框"></form>`;
    const search = await numberOf('搜索框');
    expect(await run({ op: 'act', version: search.version, act: { op: 'enter', n: search.n } }))
      .toMatchObject({ ok: false, error: 'submit' });
    const phone = await numberOf('手机');
    expect(await run({ op: 'act', version: phone.version, act: { op: 'enter', n: phone.n } }))
      .toMatchObject({ ok: false, error: 'submit', submit: { kind: 'pay' } });
  });

  it('fill writes value, dispatches input/change for controlled inputs, and selects option by text', async () => {
    document.body.innerHTML = RACE;
    const changed = vi.fn();
    document.getElementById('phone')!.addEventListener('input', changed);
    const phone = await numberOf('手机');
    expect(await run({ op: 'act', version: phone.version, act: { op: 'fill', n: phone.n, value: '138 0000 2046' } }))
      .toMatchObject({ ok: true, matches: true });
    expect((document.getElementById('phone') as HTMLInputElement).value).toBe('138 0000 2046');
    expect(changed).toHaveBeenCalled();
    const group = await numberOf('组别');
    expect(await run({ op: 'act', version: group.version, act: { op: 'select', n: group.n, value: '半程马拉松' } }))
      .toMatchObject({ ok: true, matches: true });
    expect((document.querySelector('select') as HTMLSelectElement).value).toBe('half');
  });

  it('refuses to fill password fields, card number inputs, and card-number-like text', async () => {
    document.body.innerHTML = RACE;
    const password = await numberOf('密码');
    expect(await run({ op: 'act', version: password.version, act: { op: 'fill', n: password.n, value: 'x' } }))
      .toMatchObject({ ok: false, error: 'password' });
    const card = await numberOf('卡号');
    expect(await run({ op: 'act', version: card.version, act: { op: 'fill', n: card.n, value: '1' } }))
      .toMatchObject({ ok: false, error: 'card' });
    const name = await numberOf('姓名');
    expect(await run({ op: 'act', version: name.version, act: { op: 'fill', n: name.n,
      value: '4111 1111 1111 1111' } })).toMatchObject({ ok: false, error: 'card' });
  });

  it('unchanged page reuses perception version; page changes bump version', async () => {
    document.body.innerHTML = RACE;
    const first = await perceive();
    expect((await perceive()).version).toBe(first.version);
    document.getElementById('next')!.textContent = '上一步';
    expect((await perceive()).version).not.toBe(first.version);
  });

  it('unrelated text changes keep IDs valid; missing element, renamed label, or nav expires them', async () => {
    document.body.innerHTML = RACE;
    const old = await numberOf('下一步');
    document.querySelector('h1')!.textContent = '确认报名信息';
    await perceive();
    expect(await run({ op: 'act', version: old.version, act: { op: 'click', n: old.n } }))
      .toMatchObject({ ok: true, target: { name: '下一步' } });
    const renamed = await numberOf('下一步');
    document.getElementById('next')!.textContent = '删除报名';
    expect(await run({ op: 'act', version: renamed.version, act: { op: 'click', n: renamed.n } }))
      .toMatchObject({ ok: false, error: 'stale' });
    const fresh = await numberOf('删除报名');
    document.getElementById('next')!.remove();
    expect(await run({ op: 'act', version: fresh.version, act: { op: 'click', n: fresh.n } }))
      .toMatchObject({ ok: false, error: 'stale' });
  });

  it('chat page click still succeeds with post-fill version after draft/button/message updates', async () => {
    document.body.innerHTML = `<ul id="list"><li><a href="#a">龚女士</a></li></ul><p id="time">23:31</p>
      <textarea aria-label="消息"></textarea><button class="btn-send disabled">发送</button>`;
    const box = await numberOf('消息');
    const filled = await run({ op: 'act', version: box.version, act: { op: 'fill', n: box.n, value: '您好，我是牟元礼' } });
    expect(filled).toMatchObject({ ok: true, matches: true });
    const page = await perceive();
    expect(page.version).not.toBe(box.version);
    document.querySelector('button')!.className = 'btn-send';
    document.getElementById('time')!.textContent = '23:32';
    document.getElementById('list')!.insertAdjacentHTML('afterbegin', '<li><a href="#b">[草稿] 您好</a></li>');
    await perceive();
    const send = page.elements.find((item) => item.name === '发送')!;
    const held = await run({ op: 'act', version: page.version, act: { op: 'click', n: send.n }, allowSubmit: false });
    expect(held).toMatchObject({ ok: false, error: 'submit', submit: { kind: 'publish', label: '发送' } });
    const clicked = vi.fn();
    document.querySelector('button')!.addEventListener('click', clicked);
    expect(await run({ op: 'act', version: page.version, act: { op: 'click', n: send.n }, allowSubmit: true }))
      .toMatchObject({ ok: true, submitted: 'publish' });
    vi.runOnlyPendingTimers();
    expect(clicked).toHaveBeenCalledTimes(1);
  });

  it('input value changed before submit expires both gate and approved action without sending', async () => {
    document.body.innerHTML = '<div role="textbox" contenteditable="true" aria-label="消息">原文</div><button>发送</button>';
    const page = await perceive();
    const send = page.elements.find((item) => item.name === '发送')!;
    document.querySelector('[contenteditable]')!.textContent = '别的话';
    expect(await run({ op: 'act', version: page.version, act: { op: 'click', n: send.n }, allowSubmit: false }))
      .toMatchObject({ ok: false, error: 'stale' });
    expect(await run({ op: 'act', version: page.version, act: { op: 'click', n: send.n }, allowSubmit: true }))
      .toMatchObject({ ok: false, error: 'stale' });
  });

  it('scroll action scrolls page and moves spotlight to edge', async () => {
    document.body.innerHTML = RACE;
    const scrolled = vi.spyOn(window, 'scrollBy').mockImplementation(() => undefined);
    const page = await perceive();
    expect(await run({ op: 'act', version: page.version, act: { op: 'scroll', dy: 600 } })).toMatchObject({ ok: true,
      op: 'scroll' });
    expect(scrolled).toHaveBeenCalledWith(0, 600);
    expect(document.querySelector('plasticine-dot')).not.toBeNull();
  });
});

describe('container scroll and pre-upload mark (11-16)', () => {
  it('scroll with element number scrolls its scrollable container rather than whole page', async () => {
    document.body.innerHTML = '<div id="list" style="overflow-y: auto"><a href="/c/1">示例会话甲</a>'
      + '<a href="/c/2">示例会话乙</a></div>';
    const list = document.getElementById('list')!;
    let top = 0;
    Object.defineProperty(list, 'scrollHeight', { value: 900 });
    Object.defineProperty(list, 'clientHeight', { value: 300 });
    Object.defineProperty(list, 'scrollTop', { get: () => top, set: (value: number) => { top = value; } });
    const { version, n } = await numberOf('示例会话甲');
    const done = await run({ op: 'act', version, act: { op: 'scroll', n, dy: 400 } });
    expect(done).toMatchObject({ ok: true, op: 'scroll', matches: true, target: { n, name: '示例会话甲' } });
    expect(top).toBe(400);
    const flat = await run({ op: 'act', version, act: { op: 'scroll', n, dy: 0 } });
    expect(flat).toMatchObject({ ok: true, matches: false });
  });

  it('reports clearly when no scrollable container is found', async () => {
    document.body.innerHTML = '<a href="/a">示例链接</a>';
    const { version, n } = await numberOf('示例链接');
    expect(await run({ op: 'act', version, act: { op: 'scroll', n, dy: 300 } }))
      .toMatchObject({ ok: false, error: 'unscrollable' });
  });

  it('mark tags file input controlled by upload button, or tags non-file button itself', async () => {
    document.body.innerHTML = '<label>上传简历<input type="file" accept=".pdf" style="display:none"></label>'
      + '<button type="button">选择图片</button>';
    const label = await numberOf('上传简历');
    const marked = await run({ op: 'mark', version: label.version, n: label.n, nonce: 'nonce-1' });
    expect(marked).toMatchObject({ found: true, file: true, accept: '.pdf', multiple: false });
    expect(document.querySelector('input[type=file]')?.getAttribute('data-plasticine-upload')).toBe('nonce-1');
    const button = await numberOf('选择图片');
    expect(await run({ op: 'mark', version: button.version, n: button.n, nonce: 'nonce-2' }))
      .toMatchObject({ found: true, file: false });
    expect(document.querySelector('button')?.getAttribute('data-plasticine-upload')).toBe('nonce-2');
    expect(await run({ op: 'mark', version: 'old', n: 1, nonce: 'x' })).toMatchObject({ found: false, error: 'stale' });
  });
});

describe('Enter safety regression: isolated page sends no real requests', () => {
  it.each([
    '<textarea aria-label="提问"></textarea>',
    '<input aria-label="提问">',
    '<div role="textbox" contenteditable="true" aria-label="提问"></div>',
    '<div role="search"><input aria-label="提问" type="search"></div>',
  ])('无 form 的自定义回车处理器必须先审批：%s', async (html) => {
    document.body.innerHTML = html;
    const sent = vi.fn();
    document.body.addEventListener('keydown', sent, { once: true });
    const target = await numberOf('提问');
    const result = await run({ op: 'act', version: target.version, act: { op: 'enter', n: target.n } });
    await vi.advanceTimersByTimeAsync(1);
    expect(result).toMatchObject({ ok: false, error: 'submit' });
    expect(sent).not.toHaveBeenCalled();
  });

  it('changing tail of long input invalidates approval even if truncated prefix looks identical', async () => {
    document.body.innerHTML = '<textarea aria-label="提问"></textarea>';
    const field = document.querySelector('textarea')!;
    field.value = '甲'.repeat(250) + '旧';
    const target = await numberOf('提问');
    field.value = '甲'.repeat(250) + '新';
    const result = await run({ op: 'act', version: target.version,
      act: { op: 'enter', n: target.n }, allowSubmit: true });
    expect(result).toMatchObject({ ok: false, error: 'stale' });
  });

  it('changing submit destination or hidden fields invalidates prior version', async () => {
    document.body.innerHTML = '<form action="/one"><input type="hidden" value="one"><button>提交</button></form>';
    const target = await numberOf('提交');
    document.querySelector('form')!.action = '/two';
    const result = await run({ op: 'act', version: target.version,
      act: { op: 'click', n: target.n }, allowSubmit: true });
    expect(result).toMatchObject({ ok: false, error: 'stale' });
  });

  it('scrolling is also bound to perception version', async () => {
    await perceive();
    const result = await run({ op: 'act', version: 'old', act: { op: 'scroll', dy: 100 } });
    expect(result).toMatchObject({ ok: false, error: 'stale' });
  });
});

it('approved Enter dispatches one key event without an extra duplicate form submit', async () => {
  document.body.innerHTML = '<form><input aria-label="提问"></form>';
  const sent = vi.fn();
  document.querySelector('input')!.addEventListener('keydown', sent);
  const submit = vi.spyOn(document.querySelector('form')!, 'requestSubmit').mockImplementation(() => undefined);
  const target = await numberOf('提问');
  expect(await run({ op: 'act', version: target.version, act: { op: 'enter', n: target.n }, allowSubmit: true }))
    .toMatchObject({ ok: true });
  expect(sent).toHaveBeenCalledTimes(1);
  expect(submit).not.toHaveBeenCalled();
});

it('reads body text when layout leaves innerText empty, excluding scripts and hidden text', async () => {
  document.body.innerHTML = '<p>正常正文</p><div contenteditable="true">编辑器正文</div>'
    + '<div hidden>隐藏内容</div><script>脚本内容</script><style>样式内容</style>';
  Object.defineProperty(document.body, 'innerText', { value: '', configurable: true });
  const result = await run({ op: 'read' });
  expect(result.text).toContain('正常正文');
  expect(result.text).toContain('编辑器正文');
  expect(result.text).not.toMatch(/隐藏内容|脚本内容|样式内容/);
  delete (document.body as Partial<HTMLElement>).innerText;
});

it('does not miss long editor content when innerText only covers partial body', async () => {
  const long = '正文'.repeat(7000) + '末尾证据';
  document.body.innerHTML = '<p>顶层正文</p><div contenteditable="true"></div>';
  document.querySelector('div')!.textContent = long;
  Object.defineProperty(document.body, 'innerText', { value: '顶层正文', configurable: true });
  expect((await run({ op: 'read' })).text).toContain(long);
  delete (document.body as Partial<HTMLElement>).innerText;
});

it('perception reports iframe count so native layer can spot unregistered or unreadable frames', async () => {
  document.body.innerHTML = '<iframe src="about:blank"></iframe><iframe sandbox></iframe>';
  expect(await run({ op: 'perceive' })).toMatchObject({ frameCount: 2 });
});

it('desktop inline frames number same-origin iframes together and only count cross-origin ones', async () => {
  document.body.innerHTML = '<button>外面</button><iframe></iframe><iframe></iframe>';
  const [same, closed] = Array.from(document.querySelectorAll('iframe'));
  same!.contentDocument!.body.innerHTML = '<button id="inner">里面</button>';
  Object.defineProperty(closed!, 'contentDocument', { get() { throw new Error('跨源'); } });
  let clicked = 0;
  same!.contentDocument!.getElementById('inner')!.addEventListener('click', () => { clicked += 1; });
  const page = await run({ op: 'perceive', frames: 'inline' });
  expect((page.elements as Json[]).map((item) => item.name)).toEqual(['外面', '里面']);
  expect(page.outline).toContain('〔内嵌框〕');
  expect(page.frameCount).toBe(1);
  const done = await run({ op: 'act', version: page.version, act: { op: 'click', n: 2 } });
  expect(done).toMatchObject({ ok: true, target: { name: '里面' } });
  expect(clicked).toBe(1);
});

it('base offsets numbering for cross-origin frames while actions still use frame-local IDs', async () => {
  document.body.innerHTML = '<button>一</button><button>二</button>';
  const page = await run({ op: 'perceive', base: 10 });
  expect((page.elements as Json[]).map((item) => item.n)).toEqual([11, 12]);
  expect(page.outline).toContain('[11 按钮「一」]');
  expect(await run({ op: 'act', version: page.version, act: { op: 'click', n: 2 } }))
    .toMatchObject({ ok: true, target: { name: '二' } });
});

it('real injected script output matches shared receipt protocol without extra internal counters', async () => {
  document.body.innerHTML = '<p>只读正文</p><iframe></iframe>';
  const page = await run({ op: 'perceive' });
  expect(page.frameCount).toBe(1);
  expect(Value.Check(PagePerceptionSchema, page)).toBe(true);
});
