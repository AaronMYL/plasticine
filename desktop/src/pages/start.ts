// 开始页（壳自带的静态页，打包成 dist/start.js）：主进程经地址参数告诉它显示哪一态——
// welcome（二选一）、starting（本机本体正在起）、failed（没起来 / 连不上）；「连到我的 Plasticine」的第二步在页里切。
// 只用 window.plasticineDesktop.server 的 choose（开始页能调的只有它和 status）。参数：problem（一句原因）、
// bundled（包里带没带本体）、current（选过的那一个，二选一里标出来）、remote（上次的远程地址，预填）。

import { displayPlace, NETWORK_DOMAIN, parsePlaceAddress, PlaceAddressError } from '../app/place-address.ts';

interface StartBridge {
  platform: 'macos' | 'windows' | 'linux';
  server: { choose(choice: { mode: 'this_computer' | 'remote'; remoteUrl: string | null }): Promise<unknown> };
}

const bridge = (window as Window & { plasticineDesktop?: StartBridge }).plasticineDesktop;
const params = new URLSearchParams(location.search);
const state = params.get('state') ?? 'welcome';
const current = params.get('current');
const remote = params.get('remote');
const bundled = params.get('bundled') !== '0';

function element<T extends HTMLElement>(id: string): T {
  const found = document.getElementById(id);
  if (found === null) {
    throw new Error(`开始页少了 #${id}`);
  }
  return found as T;
}

/** ipc 回来的错误带着「Error invoking remote method …: Error: 」前缀，只留给他看的那一句。 */
function reason(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error);
  return text.replace(/^Error invoking remote method '[^']*': (?:\w*Error: )?/, '');
}

function show(id: 'welcome' | 'remote' | 'starting' | 'failed'): void {
  for (const section of document.querySelectorAll('section')) {
    section.hidden = section.id !== id;
  }
}

function choose(mode: 'this_computer' | 'remote', remoteUrl: string | null): Promise<unknown> {
  if (bridge === undefined) {
    return Promise.reject(new Error('开始页没拿到客户端的接口，重新打开 Plasticine 试试。'));
  }
  return bridge.server.choose({ mode, remoteUrl });
}

const brand = element<HTMLTemplateElement>('brand');
for (const slot of document.querySelectorAll('[data-brand]')) {
  slot.replaceWith(brand.content.cloneNode(true));
}
const platform = bridge?.platform ?? 'linux';
document.documentElement.dataset.platform = platform;
element('stops-when').textContent = platform === 'macos' ? '合上盖子就停' : '关机就停';

// ---- 二选一 ----
const chooseLocal = element<HTMLButtonElement>('choose-local');
const chooseRemote = element<HTMLButtonElement>('choose-remote');
chooseLocal.classList.toggle('on', current === 'this_computer');
chooseRemote.classList.toggle('on', current === 'remote');
if (current !== null) {
  (current === 'remote' ? chooseRemote : chooseLocal).setAttribute('aria-current', 'true');
}
if (!bundled) {
  chooseLocal.disabled = true;
  element('local-tags').replaceChildren(Object.assign(document.createElement('span'),
    { textContent: '这个安装包没带' }));
}
chooseLocal.addEventListener('click', () => {
  chooseLocal.disabled = true;
  choose('this_computer', remote).catch((error: unknown) => {
    chooseLocal.disabled = false;
    showFailed(reason(error));
  });
});
chooseRemote.addEventListener('click', () => {
  show('remote');
  address.focus();
  address.select();
});

// ---- 连到我的 Plasticine ----
const form = element<HTMLFormElement>('remote-form');
const address = element<HTMLInputElement>('address');
const host = element('address-host');
const problem = element('address-error');
const connect = element<HTMLButtonElement>('connect');
address.value = remote === null ? '' : displayPlace(remote);

function preview(): void {
  problem.hidden = true;
  host.textContent = '';
  try {
    const parsed = parsePlaceAddress(address.value);
    if (parsed.handle !== null) {
      host.textContent = `${parsed.handle}.${NETWORK_DOMAIN}`;
    }
  } catch (error) {
    if (!(error instanceof PlaceAddressError)) {
      throw error;
    }
  }
}

function fail(text: string): void {
  problem.textContent = text;
  problem.hidden = false;
  address.setAttribute('aria-invalid', 'true');
}

address.addEventListener('input', () => {
  address.removeAttribute('aria-invalid');
  preview();
});
preview();
form.addEventListener('submit', (event) => {
  event.preventDefault();
  let url: string;
  try {
    url = parsePlaceAddress(address.value).url;
  } catch (error) {
    if (error instanceof PlaceAddressError) {
      fail(error.message);
      address.focus();
      return;
    }
    throw error;
  }
  connect.disabled = true;
  connect.textContent = '正在连…';
  choose('remote', url).catch((error: unknown) => {
    connect.disabled = false;
    connect.textContent = '连上';
    fail(reason(error));
  });
});
for (const back of document.querySelectorAll<HTMLButtonElement>('[data-back]')) {
  back.addEventListener('click', () => show('welcome'));
}
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && !element('remote').hidden) {
    show('welcome');
  }
});

// ---- 正在打开 / 没起来 ----
function showFailed(text: string): void {
  element('failed-title').textContent = current === 'remote' ? '连不上你的 Plasticine' : '这台电脑上的 Plasticine 没起来';
  element('failed-detail').textContent = text;
  show('failed');
}

const retry = element<HTMLButtonElement>('retry');
retry.addEventListener('click', () => {
  retry.disabled = true;
  const mode = current === 'remote' ? 'remote' : 'this_computer';
  choose(mode, remote).catch((error: unknown) => {
    retry.disabled = false;
    element('failed-detail').textContent = reason(error);
  });
});

const problemText = params.get('problem') ?? '';
if (state === 'starting') {
  const detail = element('starting-detail');
  detail.textContent = problemText;
  detail.hidden = problemText === '';
  show('starting');
} else if (state === 'failed') {
  showFailed(problemText);
} else {
  show('welcome');
}
