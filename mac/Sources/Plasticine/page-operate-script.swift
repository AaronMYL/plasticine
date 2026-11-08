enum PageOperateScript {
    static let source = #"""
const MAX_OUTLINE = 12000;
const MAX_ELEMENTS = 200;
const MAX_NAME = 80;
const MAX_VALUE = 200;
const DOT = '#5A6B85';
const DOT_IDLE_MS = 8000;
const doc = document;
const store = window.__plasticineOperate
  || (window.__plasticineOperate = { version: '', url: '', digest: '', elements: [] });

const WORDS = {
  pay: /付款|支付|结账|结算|下单|购买|买单|订购|充值|转账|汇款|打款|\bpay\b|pay now|checkout|check out|\bbuy\b|purchase|place order|order now/i,
  remove: /删除|删掉|移除|清空|注销|销户|取消订阅|\bdelete\b|\bremove\b|\bdiscard\b|\btrash\b|\bdestroy\b|unsubscribe|deactivate/i,
  settings: new RegExp('保存设置|更改设置|修改设置|修改密码|更改密码|重置密码|更新资料|保存更改|保存修改|应用设置|'
    + 'save settings|save changes|save preferences|change password|update profile|update settings|update account', 'i'),
  publish: new RegExp('发布|发帖|发表|发送|回复|评论|转发|转推|'
    + '\\bpost\\b|\\btweet\\b|\\bpublish\\b|\\bsend\\b|\\breply\\b|\\bcomment\\b|\\bretweet\\b|\\brepost\\b', 'i'),
  submit: /提交|确认|确定|完成|保存|报名|注册|预约|申请|登记|\bsubmit\b|\bconfirm\b|\bsave\b|\bapply\b|\bregister\b|sign up|\bdone\b/i,
  next: /下一步|继续|\bnext\b|\bcontinue\b/i,
  login: /登录|登陆|log ?in|sign ?in/i,
};
const PAY_HOSTS = ['alipay.com', 'pay.weixin.qq.com', 'wx.tenpay.com', 'tenpay.com', 'paypal.com',
  'checkout.stripe.com', 'pay.google.com', 'pay.apple.com', 'unionpay.com', '95516.com'];
const PAY_PATH = /\/(?:checkout|pay|payment|payments|cashier|buy|purchase|order\/(?:confirm|submit|pay))(?:[\/?#]|$)/i;
const CARD_FIELD = new RegExp('\\bcc-(?:number|csc|exp|exp-month|exp-year|name|type)\\b|card[-_]?(?:number|no)|'
  + '\\bcvv\\b|\\bcvc\\b|卡号|安全码|有效期', 'i');
const SEARCH_NAMES = /^(?:q|query|wd|kw|keyword|keywords|search|s|word)$/i;
const ROLE_NAMES = { link: '链接', button: '按钮', textbox: '输入框', checkbox: '勾选框', radio: '单选', combobox: '下拉框',
  switch: '开关', tab: '标签', menuitem: '菜单项', option: '选项' };

const clip = (text, max) => {
  const flat = String(text || '').replace(/\s+/g, ' ').trim();
  const chars = Array.from(flat);
  return chars.length > max ? chars.slice(0, max).join('') + '…' : flat;
};

const paymentUrl = (raw) => {
  let parsed = null;
  try {
    parsed = new URL(raw, location.href);
  } catch (error) {
    return true;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return /^(?:alipays?|weixin|wechat|paypal|unionpay):$/i.test(parsed.protocol);
  }
  const host = parsed.hostname.toLowerCase();
  return PAY_HOSTS.some((item) => host === item || host.endsWith('.' + item)) || PAY_PATH.test(parsed.pathname);
};

const ownHidden = (node) => {
  if (node.hidden || node.getAttribute('aria-hidden') === 'true' || node.tagName === 'PLASTICINE-DOT') {
    return true;
  }
  const style = getComputedStyle(node);
  return style.display === 'none' || style.visibility === 'hidden';
};

const hiddenByStyle = (el) => {
  for (let node = el; node && node.nodeType === 1; node = node.parentElement) {
    if (ownHidden(node)) {
      return true;
    }
  }
  return false;
};

const hasLayout = () => doc.documentElement.getBoundingClientRect().height > 0;

const visible = (el, layout) => {
  if (hiddenByStyle(el)) {
    return false;
  }
  if (!layout) {
    return true;
  }
  const rect = el.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
};

const roleOf = (el) => {
  const role = (el.getAttribute('role') || '').toLowerCase();
  if (role) {
    return role;
  }
  const tag = el.tagName;
  if (tag === 'A') {
    return 'link';
  }
  if (tag === 'BUTTON' || tag === 'SUMMARY') {
    return 'button';
  }
  if (tag === 'SELECT') {
    return 'combobox';
  }
  if (tag === 'TEXTAREA' || el.isContentEditable) {
    return 'textbox';
  }
  if (tag === 'INPUT') {
    const type = (el.getAttribute('type') || 'text').toLowerCase();
    if (type === 'checkbox' || type === 'radio') {
      return type;
    }
    if (['submit', 'button', 'reset', 'image'].includes(type)) {
      return 'button';
    }
    return 'textbox';
  }
  return 'button';
};

const labelText = (el) => {
  const aria = el.getAttribute('aria-label');
  if (aria) {
    return aria;
  }
  const by = el.getAttribute('aria-labelledby');
  if (by) {
    const text = by.split(/\s+/).map((id) => doc.getElementById(id)).filter(Boolean)
      .map((node) => node.textContent).join(' ');
    if (text.trim()) {
      return text;
    }
  }
  if (el.id) {
    const forLabel = doc.querySelector('label[for="' + CSS.escape(el.id) + '"]');
    if (forLabel && forLabel.textContent.trim()) {
      return forLabel.textContent;
    }
  }
  const wrap = el.closest('label');
  if (wrap && wrap !== el) {
    const copy = wrap.cloneNode(true);
    copy.querySelectorAll('input, select, textarea').forEach((node) => node.remove());
    if (copy.textContent.trim()) {
      return copy.textContent;
    }
  }
  return '';
};

const nameOf = (el) => {
  const tag = el.tagName;
  const own = tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA' ? labelText(el) : el.getAttribute('aria-label');
  if (own && own.trim()) {
    return clip(own, MAX_NAME);
  }
  if (tag === 'INPUT') {
    const type = (el.getAttribute('type') || 'text').toLowerCase();
    if (['submit', 'button', 'reset'].includes(type)) {
      return clip(el.value || type, MAX_NAME);
    }
    return clip(el.getAttribute('placeholder') || el.getAttribute('title') || el.name || '', MAX_NAME);
  }
  const text = (el.innerText !== undefined && hasLayout() ? el.innerText : el.textContent) || '';
  if (text.trim()) {
    return clip(text, MAX_NAME);
  }
  const img = el.querySelector('img[alt]');
  return clip(el.getAttribute('title') || (img ? img.getAttribute('alt') : '') || '', MAX_NAME);
};

const formOf = (el) => el.form || el.closest('form');

const isSearchForm = (form) => {
  if (!form) {
    return false;
  }
  if ((form.getAttribute('role') || '').toLowerCase() === 'search' || form.querySelector('input[type=search]')) {
    return true;
  }
  const method = (form.getAttribute('method') || 'get').toLowerCase();
  const fields = Array.from(form.querySelectorAll('input, textarea, select')).filter((field) => {
    const type = (field.getAttribute('type') || 'text').toLowerCase();
    return !['hidden', 'submit', 'button', 'reset', 'image'].includes(type);
  });
  return method === 'get' && fields.length === 1 && SEARCH_NAMES.test(fields[0].name || '');
};

const isLoginForm = (form, words) => !!form && !!form.querySelector('input[type=password]') && WORDS.login.test(words);

const isSubmitControl = (el) => {
  const tag = el.tagName;
  const type = (el.getAttribute('type') || '').toLowerCase();
  if (tag === 'BUTTON') {
    return type === '' || type === 'submit';
  }
  return tag === 'INPUT' && (type === 'submit' || type === 'image');
};

const navigatingLink = (el) => {
  if (el.tagName !== 'A') {
    return false;
  }
  const href = (el.getAttribute('href') || '').trim();
  return href !== '' && href !== '#' && !/^javascript:/i.test(href) && !el.getAttribute('role');
};

// 这一下是不是「提交」：先看去的地方（付款页），再看按钮上的字（付款 > 删除 > 改设置 > 发帖发消息），最后看是不是
// 表单的提交（搜索、登录、下一步不算）。判不准从严：表单里写着「确定」「保存」的按钮也算提交。
const submitKind = (el) => {
  const words = [nameOf(el), el.getAttribute('title') || '', el.id || '', el.getAttribute('name') || '',
    el.tagName === 'INPUT' ? el.value || '' : ''].join(' ');
  if (navigatingLink(el)) {
    return paymentUrl(el.getAttribute('href')) ? 'pay' : null;
  }
  const role = roleOf(el);
  if (role === 'textbox' || role === 'checkbox' || role === 'radio' || role === 'combobox' || role === 'option') {
    return null;
  }
  const form = formOf(el);
  if (WORDS.pay.test(words)) {
    return 'pay';
  }
  if (WORDS.remove.test(words)) {
    return 'delete';
  }
  if (WORDS.settings.test(words)) {
    return 'settings';
  }
  if (WORDS.publish.test(words)) {
    return 'publish';
  }
  if (form && isSubmitControl(el)) {
    if (isSearchForm(form) || isLoginForm(form, words) || WORDS.next.test(words) && !WORDS.submit.test(words)) {
      return null;
    }
    const action = form.getAttribute('action');
    return action && paymentUrl(action) ? 'pay' : 'submit';
  }
  return WORDS.submit.test(words) && (form || role === 'button') && !WORDS.next.test(words) ? 'submit' : null;
};

// 回车可由任意网页键盘处理器发送请求；没有 form、搜索外观都不是安全证明。
// 在派发任何键盘事件前拦截，不靠拦 submit 事件补救（fetch/WebSocket 不经过表单）。
const enterKind = (el) => {
  const own = submitKind(el);
  if (own) {
    return own;
  }
  const form = formOf(el);
  const button = form && Array.from(form.querySelectorAll('button, input[type=submit], input[type=image]'))
    .find((node) => isSubmitControl(node));
  return button ? submitKind(button) || 'submit' : 'submit';
};

const INTERACTIVE = 'a[href], button, input, select, textarea, summary, [role=button], [role=link], [role=checkbox], '
  + '[role=radio], [role=switch], [role=tab], [role=menuitem], [role=option], [role=combobox], [role=textbox], '
  + '[contenteditable=""], [contenteditable=true], [onclick]';

const fieldValue = (el) => {
  const tag = el.tagName;
  const type = (el.getAttribute('type') || '').toLowerCase();
  if (tag === 'INPUT' && type === 'password') {
    return null;
  }
  if (tag === 'SELECT') {
    const option = el.options[el.selectedIndex];
    return option ? clip(option.textContent, MAX_VALUE) : '';
  }
  if (tag === 'INPUT' || tag === 'TEXTAREA') {
    const plain = !['submit', 'button', 'reset', 'image', 'checkbox', 'radio'].includes(type);
    return plain ? clip(el.value, MAX_VALUE) : undefined;
  }
  return el.isContentEditable ? clip(el.textContent, MAX_VALUE) : undefined;
};

const describe = (el, n) => {
  const item = { n, role: roleOf(el), name: nameOf(el) };
  const value = fieldValue(el);
  if (value !== undefined) {
    item.value = value;
  }
  const type = (el.getAttribute('type') || '').toLowerCase();
  if (type === 'password') {
    item.password = true;
  }
  if (el.tagName === 'INPUT' && (type === 'checkbox' || type === 'radio')) {
    item.checked = !!el.checked;
  }
  if (el.disabled || el.getAttribute('aria-disabled') === 'true') {
    item.disabled = true;
  }
  if (el.tagName === 'A' && el.getAttribute('href')) {
    item.href = clip(el.href || el.getAttribute('href'), 300);
  }
  if (el.tagName === 'SELECT') {
    item.options = Array.from(el.options).slice(0, 30).map((option) => clip(option.textContent, 40));
  }
  const kind = item.role === 'textbox' ? null : submitKind(el);
  if (kind) {
    item.submit = kind;
  }
  return item;
};

const KIND_NAMES = { pay: '付款', publish: '发出去', delete: '删除', settings: '改设置', submit: '提交' };

const hash = (text) => {
  let value = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    value ^= text.charCodeAt(index);
    value = Math.imul(value, 16777619) >>> 0;
  }
  return value.toString(16);
};

const perceive = () => {
  const layout = hasLayout();
  const elements = [];
  const items = [];
  const numbered = new Map();
  for (const el of doc.querySelectorAll(INTERACTIVE)) {
    if (elements.length >= MAX_ELEMENTS) {
      break;
    }
    if (el.tagName === 'INPUT' && (el.getAttribute('type') || '').toLowerCase() === 'hidden' || !visible(el, layout)) {
      continue;
    }
    if (el.parentElement && el.parentElement.closest(INTERACTIVE) && el.tagName !== 'INPUT' && el.tagName !== 'SELECT'
      && el.tagName !== 'TEXTAREA') {
      continue;
    }
    elements.push(el);
    const item = describe(el, elements.length);
    items.push(item);
    numbered.set(el, item);
  }
  const parts = [];
  let size = 0;
  let total = 0;
  const push = (text) => {
    total += text.length;
    if (size < MAX_OUTLINE) {
      parts.push(text);
      size += text.length;
    }
  };
  const elementLine = (item) => {
    const bits = ['[' + item.n + ' ' + (ROLE_NAMES[item.role] || item.role) + (item.name ? '「' + item.name + '」' : '')];
    if (item.value !== undefined && item.value !== null && item.value !== '') {
      bits.push('= ' + item.value);
    }
    if (item.password) {
      bits.push('密码框');
    }
    if (item.checked !== undefined) {
      bits.push(item.checked ? '已勾' : '未勾');
    }
    if (item.disabled) {
      bits.push('不可用');
    }
    if (item.submit) {
      bits.push('提交：' + KIND_NAMES[item.submit]);
    }
    return bits.join(' ') + ']';
  };
  const walk = (node) => {
    if (node.nodeType === 3) {
      const text = node.textContent.replace(/\s+/g, ' ').trim();
      if (text) {
        push(text + ' ');
      }
      return;
    }
    if (node.nodeType !== 1) {
      return;
    }
    const tag = node.tagName;
    if (['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'SVG', 'PLASTICINE-DOT', 'PLASTICINE-CIRCLE'].includes(tag)) {
      return;
    }
    if (ownHidden(node)) {
      return;
    }
    const item = numbered.get(node);
    if (item) {
      push('\n' + elementLine(item) + '\n');
      return;
    }
    const heading = /^H[1-6]$/.test(tag);
    const block = heading || ['P', 'DIV', 'LI', 'TR', 'SECTION', 'ARTICLE', 'HEADER', 'FOOTER', 'FORM', 'LABEL',
      'NAV', 'MAIN', 'ASIDE', 'UL', 'OL', 'TABLE', 'FIELDSET', 'DT', 'DD', 'BR'].includes(tag);
    if (block) {
      push('\n' + (heading ? '#'.repeat(Number(tag[1])) + ' ' : ''));
    }
    if (tag === 'IMG' && node.getAttribute('alt')) {
      push('〔图：' + clip(node.getAttribute('alt'), MAX_NAME) + '〕');
    }
    for (const child of node.childNodes) {
      walk(child);
    }
    if (block) {
      push('\n');
    }
  };
  walk(doc.body || doc.documentElement);
  const outline = parts.join('').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  const textChars = (doc.body ? doc.body.textContent : '').replace(/\s+/g, '').length;
  const pictures = doc.querySelectorAll('img, canvas, video, svg').length;
  const digest = hash(outline);
  // 审批绑定完整本地状态，不只绑定被截断的大纲。完整值只在隔离脚本世界比较，不回传。
  const copy = doc.documentElement.cloneNode(true);
  copy.querySelectorAll('plasticine-dot, plasticine-circle').forEach((node) => node.remove());
  const values = Array.from(doc.querySelectorAll('input, textarea, select')).map((el) =>
    [el.value, el.checked, el.selectedIndex]);
  const signature = JSON.stringify([copy.outerHTML, values]);
  // 页面没变（地址和大纲一样、元素还是那几个）就沿用上一次的编号版本：「问这一页」每发一句都感知一次，没变的页面
  // 不让脑手里的编号作废。
  const same = store.signature === signature && store.digest === digest && store.url === location.href && store.elements.length === elements.length
    && store.elements.every((el, index) => el === elements[index]);
  if (!same) {
    store.version = Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }
  store.signature = signature;
  store.url = location.href;
  store.digest = digest;
  store.elements = elements;
  return { version: store.version, url: location.href, title: doc.title, outline, totalChars: total,
    frameCount: doc.querySelectorAll('iframe, frame').length,
    truncated: total > size, elements: items, imageHeavy: textChars < 200 && pictures > 0, digest };
};

const dot = () => {
  let mark = doc.querySelector('plasticine-dot');
  if (!mark) {
    mark = doc.createElement('plasticine-dot');
    mark.setAttribute('aria-hidden', 'true');
    const motion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'none'
      : 'left 240ms ease, top 240ms ease';
    mark.style.cssText = 'position:fixed;width:12px;height:12px;margin:-6px 0 0 -6px;border-radius:50%;'
      + 'background:' + DOT + ';box-shadow:0 0 0 6px rgba(90,107,133,0.2);pointer-events:none;'
      + 'z-index:2147483647;transition:' + motion + ';';
    (doc.body || doc.documentElement).appendChild(mark);
  }
  clearTimeout(store.dotTimer);
  store.dotTimer = setTimeout(() => mark.remove(), DOT_IDLE_MS);
  return mark;
};

const pointAt = (el) => {
  if (typeof el.scrollIntoView === 'function') {
    el.scrollIntoView({ block: 'center', inline: 'nearest' });
  }
  const rect = el.getBoundingClientRect();
  const mark = dot();
  mark.style.left = Math.round(rect.left + Math.min(rect.width / 2, 24)) + 'px';
  mark.style.top = Math.round(rect.top + rect.height / 2) + 'px';
};

const luhnCard = (text) => (String(text).match(/(?:\d[ -]?){13,19}/g) || []).some((match) => {
  const digits = match.replace(/\D/g, '');
  if (digits.length < 13 || digits.length > 19) {
    return false;
  }
  let sum = 0;
  for (let index = 0; index < digits.length; index += 1) {
    let digit = Number(digits[digits.length - 1 - index]);
    if (index % 2 === 1) {
      digit *= 2;
      if (digit > 9) {
        digit -= 9;
      }
    }
    sum += digit;
  }
  return sum % 10 === 0;
});

const setValue = (el, value) => {
  const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
  setter.call(el, value);
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
};

const fill = (el, value) => {
  const type = (el.getAttribute('type') || '').toLowerCase();
  const hint = [el.getAttribute('autocomplete') || '', el.name || '', el.id || '', nameOf(el)].join(' ');
  if (type === 'password') {
    return { ok: false, error: 'password' };
  }
  if (CARD_FIELD.test(hint) || luhnCard(value)) {
    return { ok: false, error: 'card' };
  }
  if (el.disabled || el.readOnly) {
    return { ok: false, error: 'disabled' };
  }
  if (typeof el.focus === 'function') {
    el.focus();
  }
  if (el.isContentEditable) {
    el.textContent = value;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    return { ok: true, matches: el.textContent === value };
  }
  if (el.tagName !== 'INPUT' && el.tagName !== 'TEXTAREA') {
    return { ok: false, error: 'unfillable' };
  }
  setValue(el, value);
  return { ok: true, matches: el.value === value };
};

const choose = (el, value) => {
  if (el.tagName !== 'SELECT') {
    return { ok: false, error: 'unfillable' };
  }
  const option = Array.from(el.options).find((item) => item.value === value || item.textContent.trim() === value);
  if (!option) {
    return { ok: false, error: 'option' };
  }
  el.value = option.value;
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
  return { ok: true, matches: el.value === option.value };
};

const press = (el) => {
  for (const type of ['pointerdown', 'mousedown', 'pointerup', 'mouseup']) {
    el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true }));
  }
  el.click();
};

const pressEnter = (el) => {
  const options = { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true };
  // 自定义键盘处理器可能已经发送。不能再补 requestSubmit，否则会重复提交。
  el.dispatchEvent(new KeyboardEvent('keydown', options));
  el.dispatchEvent(new KeyboardEvent('keyup', options));
};

const act = (request) => {
  const step = request.act || {};
  // 重新读取后才比较版本；输入值、目的地或节点身份变了，旧审批绝不能继续用。
  perceive();
  if (request.version !== store.version || store.url !== location.href) {
    return { ok: false, error: 'stale' };
  }
  if (step.op === 'scroll') {
    const dy = Number(step.dy) || 0;
    window.scrollBy(0, dy);
    const mark = dot();
    mark.style.left = Math.round(window.innerWidth - 24) + 'px';
    mark.style.top = Math.round(dy > 0 ? window.innerHeight - 24 : 24) + 'px';
    return { ok: true, op: 'scroll' };
  }
  if (request.version !== store.version || store.url !== location.href) {
    return { ok: false, error: 'stale' };
  }
  const el = store.elements[Number(step.n) - 1];
  if (!el || !el.isConnected) {
    return { ok: false, error: 'stale' };
  }
  const target = { n: Number(step.n), role: roleOf(el), name: nameOf(el) };
  if (step.op === 'click' || step.op === 'enter') {
    const kind = step.op === 'enter' ? enterKind(el) : submitKind(el);
    if (kind && request.allowSubmit !== true) {
      return { ok: false, error: 'submit', target, submit: { kind, label: target.name } };
    }
    if (el.disabled || el.getAttribute('aria-disabled') === 'true') {
      return { ok: false, error: 'disabled', target };
    }
    pointAt(el);
    if (step.op === 'enter') {
      pressEnter(el);
    } else {
      press(el);
    }
    return { ok: true, op: step.op, target, submitted: kind || null };
  }
  if (step.op === 'fill' || step.op === 'select') {
    pointAt(el);
    const done = step.op === 'fill' ? fill(el, String(step.value || '')) : choose(el, String(step.value || ''));
    return Object.assign({ op: step.op, target }, done);
  }
  return { ok: false, error: 'op' };
};

if (request.op === 'read') {
  // 后台 WebView 的 innerText 可能为空或只含部分布局；按 DOM 读取，但仍排除隐藏/非正文节点。
  const parts = [];
  const read = (node) => {
    if (node.nodeType === 3) {
      parts.push(node.textContent);
      return;
    }
    if (node.nodeType !== 1 || ownHidden(node)
      || ['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'SVG', 'PLASTICINE-DOT'].includes(node.tagName)) {
      return;
    }
    const block = /^(H[1-6]|P|DIV|LI|TR|SECTION|ARTICLE|BR|MAIN|HEADER|FOOTER)$/.test(node.tagName);
    if (block) parts.push('\n');
    for (const child of node.childNodes) read(child);
    if (block) parts.push('\n');
  };
  if (doc.body) read(doc.body);
  const text = parts.join('').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
  return JSON.stringify({ text });
}
if (request.op === 'perceive') {
  return JSON.stringify(perceive());
}
if (request.op === 'act') {
  return JSON.stringify(act(request));
}
return JSON.stringify({ ok: false, error: 'op' });
"""#
}
