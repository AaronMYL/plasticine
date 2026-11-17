enum PageOperateScript {
    static let source = #"""
const MAX_OUTLINE = 12000;
const MAX_ELEMENTS = 200;
const MAX_NAME = 80;
const MAX_VALUE = 200;
const DOT = '#5A6B85';
const DOT_IDLE_MS = 8000;
const doc = document;
const KEEP_NUMBERINGS = 12;
const store = window.__plasticineOperate || (window.__plasticineOperate = {});
if (!Array.isArray(store.numberings)) {
  store.numberings = [];
}
if (request.frames === 'inline') {
  store.inline = true;
}

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
// 没写成按钮、靠 cursor:pointer 能点的一行（会话列表、卡片）：字多的是一整行内容，不按字判提交。
const ROW_NAME_MAX = 12;
const ROLE_NAMES = { link: '链接', button: '按钮', textbox: '输入框', checkbox: '勾选框', radio: '单选', combobox: '下拉框',
  switch: '开关', tab: '标签', menuitem: '菜单项', option: '选项', file: '上传框（用 tab_upload）' };

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

// 内嵌框里的节点按它自己那一页的窗口算样式。
const styleOf = (node) => ((node.ownerDocument && node.ownerDocument.defaultView) || window).getComputedStyle(node);

const ownHidden = (node) => {
  if (node.hidden || node.getAttribute('aria-hidden') === 'true' || node.tagName === 'PLASTICINE-DOT') {
    return true;
  }
  const style = styleOf(node);
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
    if (type === 'file') {
      return 'file';
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
    const text = by.split(/\s+/).map((id) => el.ownerDocument.getElementById(id)).filter(Boolean)
      .map((node) => node.textContent).join(' ');
    if (text.trim()) {
      return text;
    }
  }
  if (el.id) {
    const forLabel = el.ownerDocument.querySelector('label[for="' + CSS.escape(el.id) + '"]');
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
  if (!el.matches(INTERACTIVE) && Array.from(nameOf(el)).length > ROW_NAME_MAX) {
    return null;
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

// 页面上靠 cursor:pointer 能点、却没写成链接按钮的那一块（会话列表一行、卡片）：取最外层的那一个；整屏大的不算。
const pointerRoot = (el) => {
  const own = el.ownerDocument;
  if (el.matches(INTERACTIVE) || el === own.body || el === own.documentElement) {
    return false;
  }
  if (styleOf(el).cursor !== 'pointer') {
    return false;
  }
  const parent = el.parentElement;
  if (parent && styleOf(parent).cursor === 'pointer') {
    return false;
  }
  return el.getBoundingClientRect().height <= window.innerHeight * 0.6;
};

// 管着一个藏起来的文件框的 label（「上传简历」）也编号：上传要点的是它（11-16 tab_upload）。
const uploadLabel = (el, layout) => el.tagName === 'LABEL' && el.control
  && String(el.control.type).toLowerCase() === 'file' && !visible(el.control, layout);

// 读得进去的内嵌框（同源、看得见）里的那一页；读不进去的（跨源）只数个数。
const innerDoc = (frame) => {
  let inner = null;
  try {
    inner = frame.contentDocument;
  } catch (error) {
    inner = null;
  }
  return inner && inner.documentElement ? inner : null;
};

const frameShown = (frame) => {
  if (hiddenByStyle(frame)) {
    return false;
  }
  const rect = frame.getBoundingClientRect();
  return !hasLayout() || rect.width > 0 && rect.height > 0;
};

// 这一页和它里面读得进去的内嵌框（深度优先，按页面上的顺序）。
const docsOf = (root) => {
  const list = [root];
  if (!store.inline) {
    return list;
  }
  for (const frame of Array.from(root.querySelectorAll('iframe, frame'))) {
    const inner = innerDoc(frame);
    if (inner && frameShown(frame)) {
      list.push(...docsOf(inner));
    }
  }
  return list;
};

const closedIn = (page) => Array.from(page.querySelectorAll('iframe, frame'))
  .filter((frame) => !innerDoc(frame) && frameShown(frame)).length;

const closedFrames = () => (store.inline ? docsOf(doc).reduce((count, page) => count + closedIn(page), 0)
  : doc.querySelectorAll('iframe, frame').length);

const candidatesIn = (page, layout) => {
  const interactive = Array.from(page.querySelectorAll(INTERACTIVE + ', label'))
    .filter((el) => el.tagName !== 'LABEL' || uploadLabel(el, layout));
  if (!layout || !page.body) {
    return interactive;
  }
  const known = new Set(interactive);
  return Array.from(page.body.querySelectorAll('*')).filter((el) => known.has(el) || pointerRoot(el));
};

const candidates = (layout) => docsOf(doc).reduce((all, page) => all.concat(candidatesIn(page, layout)), []);

// 内嵌框里的元素在最外面这一页上的位置：一层层加上框自己的位置和边框。
const frameOffset = (el) => {
  let x = 0;
  let y = 0;
  for (let view = el.ownerDocument.defaultView; view && view !== window; view = view.parent) {
    const frame = view.frameElement;
    if (!frame) {
      break;
    }
    const rect = frame.getBoundingClientRect();
    x += rect.left + frame.clientLeft;
    y += rect.top + frame.clientTop;
  }
  return { x, y };
};

// 页面上填的值和表单发往哪里：输入框、勾选、下拉、可编辑区的全文，表单的 action / method / target 和按钮的 formaction。
// 提交前和那一版比，变了就不提交（审批绑的就是这些，不是整页 HTML）。
const fieldsIn = (page) => {
  const values = Array.from(page.querySelectorAll('input, textarea, select')).map((el) =>
    [el.value, el.checked, el.selectedIndex]);
  const editors = Array.from(page.querySelectorAll('[contenteditable]'))
    .filter((el) => (el.getAttribute('contenteditable') || '').toLowerCase() !== 'false')
    .map((el) => el.textContent);
  const forms = Array.from(page.querySelectorAll('form')).map((form) =>
    [form.getAttribute('action'), form.getAttribute('method'), form.getAttribute('target')]);
  const overrides = Array.from(page.querySelectorAll('[formaction]')).map((el) => el.getAttribute('formaction'));
  return [values, editors, forms, overrides];
};

// 有内嵌框时每一页各一份（编辑器在框里，填的字也要算进去）。
const fieldsOf = () => {
  const pages = docsOf(doc);
  return JSON.stringify(pages.length === 1 ? fieldsIn(doc) : pages.map(fieldsIn));
};

const perceive = (base) => {
  const layout = hasLayout();
  const elements = [];
  const items = [];
  const numbered = new Map();
  for (const el of candidates(layout)) {
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
    const item = describe(el, base + elements.length);
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
    if ((tag === 'IFRAME' || tag === 'FRAME') && store.inline) {
      const inner = innerDoc(node);
      if (inner && frameShown(node)) {
        push('\n〔内嵌框〕\n');
        walk(inner.body || inner.documentElement);
        push('\n〔内嵌框完〕\n');
      }
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
  // 编号版本：地址、编了号的那几个节点（同一个节点、同一个角色和名字）、页面上填的值都没变，就沿用上一版。
  // 填的值、表单发往哪里的完整内容只在隔离脚本世界比较，不回传。
  const names = items.map((item) => item.role + '\u0001' + item.name);
  const fields = fieldsOf();
  const last = store.numberings[store.numberings.length - 1];
  const same = !!last && last.url === location.href && last.fields === fields
    && last.elements.length === elements.length
    && last.elements.every((el, index) => el === elements[index] && last.names[index] === names[index]);
  let current = last;
  if (!same) {
    current = { version: Date.now().toString(36) + Math.random().toString(36).slice(2, 8), url: location.href,
      elements, names, fields };
    store.numberings.push(current);
    if (store.numberings.length > KEEP_NUMBERINGS) {
      store.numberings.shift();
    }
  }
  return { version: current.version, url: location.href, title: doc.title, outline, totalChars: total,
    frameCount: closedFrames(),
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
  const offset = frameOffset(el);
  const mark = dot();
  mark.style.left = Math.round(offset.x + rect.left + Math.min(rect.width / 2, 24)) + 'px';
  mark.style.top = Math.round(offset.y + rect.top + rect.height / 2) + 'px';
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
  const view = el.ownerDocument.defaultView || window;
  const proto = el.tagName === 'TEXTAREA' ? view.HTMLTextAreaElement.prototype : view.HTMLInputElement.prototype;
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

const scrollArea = (el) => {
  for (let node = el; node && node !== node.ownerDocument.documentElement; node = node.parentElement) {
    const style = styleOf(node);
    if (/(auto|scroll|overlay)/.test(style.overflowY) && node.scrollHeight > node.clientHeight + 1) {
      return node;
    }
  }
  return null;
};

/**
 * 上传前认一下这个编号（11-16 tab_upload）：是文件框就给它打记号，原生层按记号把文件放进去；是「上传」按钮，找它
 * 管着的文件框（label 的 control、里面的文件框），找不到就回它的中心，原生层可信点击后接住弹出的「选择文件」。
 */
const markForUpload = (request) => {
  const numbering = store.numberings.find((item) => item.version === request.version);
  if (!numbering || numbering.url !== location.href) {
    return { found: false, error: 'stale' };
  }
  const el = numbering.elements[Number(request.n) - 1];
  if (!el || !el.isConnected) {
    return { found: false, error: 'stale' };
  }
  const isFile = (node) => node && node.tagName === 'INPUT' && String(node.type).toLowerCase() === 'file';
  const input = isFile(el) ? el : isFile(el.control) ? el.control
    : el.querySelector ? el.querySelector('input[type=file]') : null;
  const target = input || el;
  target.setAttribute('data-plasticine-upload', String(request.nonce));
  pointAt(el);
  const rect = el.getBoundingClientRect();
  const offset = frameOffset(el);
  const center = rect.width > 0 && rect.height > 0
    ? { x: Math.round(offset.x + rect.left + rect.width / 2), y: Math.round(offset.y + rect.top + rect.height / 2) }
    : null;
  return { found: true, file: Boolean(input), multiple: Boolean(input && input.multiple),
    accept: input ? String(input.accept || '') : '', role: roleOf(el), name: nameOf(el), center };
};

const act = (request) => {
  const step = request.act || {};
  // 按脑手里那一版的编号找节点：那一版还留着、地址没换。
  const numbering = store.numberings.find((item) => item.version === request.version);
  if (!numbering || numbering.url !== location.href) {
    return { ok: false, error: 'stale' };
  }
  if (step.op === 'scroll' && step.n === undefined) {
    const dy = Number(step.dy) || 0;
    window.scrollBy(0, dy);
    const mark = dot();
    mark.style.left = Math.round(window.innerWidth - 24) + 'px';
    mark.style.top = Math.round(dy > 0 ? window.innerHeight - 24 : 24) + 'px';
    return { ok: true, op: 'scroll' };
  }
  const el = numbering.elements[Number(step.n) - 1];
  if (step.op === 'scroll') {
    // 在某一块里面滚（会话列表、弹窗里的长列表）：从这个编号往外找第一层能滚的。
    if (!el || !el.isConnected) {
      return { ok: false, error: 'stale' };
    }
    const area = scrollArea(el);
    if (!area) {
      return { ok: false, error: 'unscrollable' };
    }
    const from = area.scrollTop;
    area.scrollTop = from + (Number(step.dy) || 0);
    pointAt(el);
    return { ok: true, op: 'scroll', target: { n: Number(step.n), role: roleOf(el), name: nameOf(el) },
      matches: area.scrollTop !== from };
  }
  if (!el || !el.isConnected || hiddenByStyle(el)) {
    return { ok: false, error: 'stale' };
  }
  const target = { n: Number(step.n), role: roleOf(el), name: nameOf(el) };
  const seen = numbering.names[Number(step.n) - 1];
  // 还是那一个节点，而且还是那个角色、那个名字（列表复用节点换了内容就不认）；填和选会改可编辑框的名字，只核角色。
  const editing = step.op === 'fill' || step.op === 'select';
  if (editing ? seen.split('\u0001')[0] !== target.role : seen !== target.role + '\u0001' + target.name) {
    return { ok: false, error: 'stale' };
  }
  if (step.op === 'click' || step.op === 'enter') {
    const kind = step.op === 'enter' ? enterKind(el) : submitKind(el);
    // 提交（拦下和放行都一样）：页面上填的值、表单发往哪里得和脑看到的那一版一样，变了旧审批绝不能继续用。
    if (kind && fieldsOf() !== numbering.fields) {
      return { ok: false, error: 'stale' };
    }
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
  return JSON.stringify(perceive(Math.max(0, Math.floor(Number(request.base) || 0))));
}
if (request.op === 'at') {
  // 按位置点之前认一下点到的是什么（11-16 tab_point）：往上找到能点的那一层，按同一套规矩判是不是提交。
  let x = Number(request.x);
  let y = Number(request.y);
  let page = doc;
  let el = typeof doc.elementFromPoint === 'function' ? doc.elementFromPoint(x, y) : null;
  // 点到同源内嵌框上：换成框里那一页的坐标接着找。
  while (el && store.inline && (el.tagName === 'IFRAME' || el.tagName === 'FRAME') && innerDoc(el)) {
    const rect = el.getBoundingClientRect();
    x -= rect.left + el.clientLeft;
    y -= rect.top + el.clientTop;
    page = innerDoc(el);
    el = page.elementFromPoint(x, y);
  }
  while (el && el !== page.body && !el.matches(INTERACTIVE) && !(hasLayout() && pointerRoot(el))) {
    el = el.parentElement;
  }
  if (!el || el === page.body) {
    return JSON.stringify({ found: false });
  }
  return JSON.stringify({ found: true, role: roleOf(el), name: nameOf(el), submit: submitKind(el) || null });
}
if (request.op === 'act') {
  return JSON.stringify(act(request));
}
if (request.op === 'mark') {
  return JSON.stringify(markForUpload(request));
}
return JSON.stringify({ ok: false, error: 'op' });
"""#
}
