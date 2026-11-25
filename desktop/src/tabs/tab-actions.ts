import { createHash, randomUUID } from 'node:crypto';
import { Value } from 'typebox/value';
import type { NativeImage } from 'electron';
import type { DeviceActionParams, PageOperateEvent } from '../../../agent/shared/api/index.ts';
import { PagePerceptionSchema } from '../../../agent/shared/api/page-operate.ts';
import { classifyLane, isPaymentPage } from '../../../agent/shared/device-lanes.ts';
import { DeviceRefused, TabActionError, type StepReporter, type TabActionPort } from '../node/action-runner.ts';
import { type KeyStroke, trustedClick, trustedInsert, trustedKey, trustedWheel } from './cdp.ts';
import { runMoreTab } from './tab-more.ts';
import { KeyRefused, keyStroke } from './key-spec.ts';
import { TabFrames } from './tab-frames.ts';
import { uploadTo } from './tab-upload.ts';
import type { Located, TargetFacts } from './tab-dom.ts';
import type { Tab, TabViews } from './tab-views.ts';

const PRESENT_MS = 30_000;
const SETTLE_MS = 600;
const FILL_SETTLE_MS = 400;
const LOAD_WAIT_MS = 10_000;
const SHOT_QUALITY = 80;
const MATCH_PREFIX = 200;

export interface TabActionDeps {
  tabs: TabViews;
  windowFocused(): boolean;
  confirm(message: string): Promise<boolean>;
  operate(event: PageOperateEvent): void;
  show(tabId: string): void;
  platform: NodeJS.Platform;
}

const FILL_ERRORS: Readonly<Record<string, string>> = {
  missing: '页面上找不到要填的那个框了。',
  disabled: '这个框现在不能填（禁用或只读）。',
  option: '下拉框里没有这一项。',
  unfillable: '这个元素不是输入框或下拉框，填不进去。',
  password: '密码框不由 Plasticine 填：请你自己填。',
  card: '银行卡号、安全码这类不由 Plasticine 填。',
  unscrollable: '这个编号所在的地方没有能滚的一块：换列表里的一个编号，或者 tab_shot 看一眼再用 tab_scroll 按位置滚。',
};

const CAPTURE_MS = 8_000;
const WAIT_POLL_MS = 500;
const BOTTOM_SETTLE_MS = 200;

function within<T>(promise: Promise<T>, ms: number): Promise<T | null> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => resolve(null), ms);
    promise.then((value) => {
      clearTimeout(timer);
      resolve(value);
    }, (error: unknown) => {
      clearTimeout(timer);
      reject(error instanceof Error ? error : new Error(String(error)));
    });
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function digest(state: unknown): { url: string; title: string; digest: string } {
  const value = state as { url?: unknown; title?: unknown; state?: unknown };
  return { url: String(value.url ?? ''), title: String(value.title ?? ''),
    digest: createHash('sha256').update(String(value.state ?? '')).digest('hex') };
}

export class TabActions implements TabActionPort {
  private readonly deps: TabActionDeps;
  private readonly frames: TabFrames;

  constructor(deps: TabActionDeps) {
    this.deps = deps;
    this.frames = new TabFrames({ call: (id, op, args) => deps.tabs.call(id, op, args),
      callFrame: (id, frame, op, args) => deps.tabs.callFrame(id, frame, op, args),
      crossFrames: (id) => deps.tabs.crossFrames(id) });
  }

  available(): boolean {
    return true;
  }

  viewing(): string | null {
    const active = this.deps.tabs.active;
    return active !== null && this.deps.windowFocused() && this.deps.tabs.frame !== null ? active.id : null;
  }

  async run(action: DeviceActionParams, step: StepReporter = () => undefined): Promise<Record<string, unknown>> {
    switch (action.kind) {
      case 'tab_list':
        return { tabs: this.deps.tabs.list().map((tab) => ({ tabId: tab.id, url: tab.view.webContents.getURL(),
          title: tab.view.webContents.getTitle(), active: tab === this.deps.tabs.active,
          loading: tab.view.webContents.isLoading() })), viewing: this.viewing() };
      case 'tab_read':
        return { tabId: action.tabId, ...await this.call(action.tabId, 'read', { offset: action.offset }) };
      case 'tab_open': {
        const tab = this.deps.tabs.open(action.url, 'plasticine', false);
        return this.page(tab, await this.waitLoad(tab));
      }
      case 'tab_navigate': {
        const tab = this.tab(action.tabId);
        this.deps.tabs.navigate(tab.id, action.url);
        await sleep(SETTLE_MS);
        return this.page(tab, await this.waitLoad(tab));
      }
      case 'tab_click':
        return this.click(action.tabId, action.selector, action.text);
      case 'tab_fill':
        return this.fill(action.tabId, action.selector, action.value);
      case 'tab_perceive':
        return { tabId: action.tabId, ...await this.perceive(action.tabId) };
      case 'tab_act':
        return this.act(action);
      case 'tab_shot':
        return this.shot(action.tabId, step);
      case 'tab_point':
        return this.point(action.tabId, action.x, action.y);
      case 'tab_type':
        return this.type(action.tabId, action.text);
      case 'tab_close':
        if (!this.deps.tabs.closeOwn(this.tab(action.tabId).id)) {
          throw new DeviceRefused('这个标签是他自己开的，Plasticine 不关。');
        }
        return { tabId: action.tabId };
      case 'tab_wait':
        return this.wait(action.tabId, action.text, action.gone === true, action.timeoutSeconds * 1000, step);
      case 'tab_key':
        return this.key(action.tabId, action.key);
      case 'tab_scroll':
        return this.scroll(action.tabId, action.x, action.y, action.dy);
      case 'tab_paste':
        return this.paste(action.tabId, action.text, action.html);
      case 'tab_show':
        this.deps.show(this.tab(action.tabId).id);
        return { tabId: action.tabId };
      case 'tab_upload':
        return this.upload(action, step);
      case 'tab_hover':
      case 'tab_drag':
      case 'tab_downloads':
      case 'tab_dialog':
        return runMoreTab(action, { tab: (id) => this.tab(id), present: (tab) => this.present(tab),
          call: (id, op, args) => this.call(id, op, args) });
      default:
        throw new TabActionError(null, '这一步不是网页标签的事。');
    }
  }

  private tab(tabId: string): Tab {
    const tab = this.deps.tabs.get(tabId);
    if (tab === null) {
      throw new TabActionError(null, '没有这个网页标签了（可能被关掉了），先 tab_list 看看。');
    }
    return tab;
  }

  private present(tab: Tab): void {
    if (this.viewing() === tab.id && Date.now() - tab.lastInputAt < PRESENT_MS) {
      throw new TabActionError('user_present', '你正看着这个标签，Plasticine 等你停下来再做。');
    }
  }

  private async call(tabId: string, op: string, args: Record<string, unknown>): Promise<Record<string, unknown>> {
    const value = await this.deps.tabs.call(this.tab(tabId).id, op, args);
    if (typeof value !== 'object' || value === null) {
      throw new TabActionError(null, '页面回的结果格式不对，重新读一下再做。');
    }
    return value as Record<string, unknown>;
  }

  private async waitLoad(tab: Tab): Promise<boolean> {
    const contents = tab.view.webContents;
    if (!contents.isLoading()) {
      return true;
    }
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        contents.off('did-stop-loading', done);
        resolve(false);
      }, LOAD_WAIT_MS);
      const done = (): void => {
        clearTimeout(timer);
        resolve(true);
      };
      contents.once('did-stop-loading', done);
    });
  }

  private page(tab: Tab, loaded: boolean): Record<string, unknown> {
    return { tabId: tab.id, url: tab.view.webContents.getURL(), title: tab.view.webContents.getTitle(), loaded };
  }

  private async judge(facts: TargetFacts, kind: 'tab_click' | 'tab_fill', tabId: string, value: string):
    Promise<void> {
    if (isPaymentPage(facts.pageUrl) || (facts.formAction !== '' && isPaymentPage(facts.formAction))) {
      throw new DeviceRefused('这一页是付款或下单页面：付款、下单、转账这一类一律不做（关死）。');
    }
    const selector = `${facts.name} ${facts.autocomplete}${facts.isPassword ? ' type=password' : ''}`.trim() || '*';
    const lane = kind === 'tab_click'
      ? classifyLane({ kind, tabId, selector, text: facts.label === '' ? null : facts.label }, '')
      : classifyLane({ kind, tabId, selector, value }, '');
    if (lane.lane === 'deny') {
      throw new DeviceRefused(lane.reason);
    }
    if (lane.lane === 'confirm' && !await this.deps.confirm(lane.reason)) {
      throw new DeviceRefused('你在这台电脑上点了「不做」。');
    }
  }

  private async locate(tabId: string, selector: string | null, text: string | null, nonce: string):
    Promise<Located & { found: true }> {
    const located = await this.call(tabId, 'locate', { selector, text, nonce }) as Located;
    if (!located.found) {
      throw new TabActionError(null, located.error === 'selector' ? '选择器写得不对。' : '页面上找不到要点的那个元素。');
    }
    return located;
  }

  private async click(tabId: string, selector: string | null, text: string | null): Promise<Record<string, unknown>> {
    const tab = this.tab(tabId);
    this.present(tab);
    const nonce = randomUUID();
    const located = await this.locate(tabId, selector, text, nonce);
    await this.judge(located.facts, 'tab_click', tabId, '');
    const before = digest(await this.call(tabId, 'state', { nonce, cleanup: false }));
    await this.call(tabId, 'click', { nonce });
    let after = await this.settled(tab, nonce);
    if (after.digest === before.digest && after.url === before.url) {
      const center = await this.call(tabId, 'center', { nonce }).catch(() => null);
      if (center !== null && typeof center.x === 'number' && typeof center.y === 'number') {
        await trustedClick(tab.view.webContents, center.x, center.y);
        after = await this.settled(tab, nonce);
      }
    }
    await this.call(tabId, 'state', { nonce, cleanup: true }).catch(() => null);
    return { tabId, target: { tag: located.tag, text: located.text }, before, after,
      changed: after.digest !== before.digest || after.url !== before.url };
  }

  private async settled(tab: Tab, nonce: string): Promise<{ url: string; title: string; digest: string }> {
    await sleep(SETTLE_MS);
    await this.waitLoad(tab);
    return digest(await this.call(tab.id, 'state', { nonce, cleanup: false }));
  }

  private async fill(tabId: string, selector: string, value: string): Promise<Record<string, unknown>> {
    const tab = this.tab(tabId);
    this.present(tab);
    const nonce = randomUUID();
    const located = await this.locate(tabId, selector, null, nonce);
    await this.judge(located.facts, 'tab_fill', tabId, value);
    const filled = await this.call(tabId, 'fill', { nonce, value });
    if (filled.ok !== true) {
      throw new TabActionError(null, FILL_ERRORS[String(filled.error)] ?? '这个框没填进去。');
    }
    return { tabId, selector, tag: filled.tag, type: filled.type, matches: filled.matches };
  }

  private async perceive(tabId: string): Promise<Record<string, unknown>> {
    this.tab(tabId);
    const page = await this.frames.perceive(tabId);
    if (page === null || !Value.Check(PagePerceptionSchema, page)) {
      throw new TabActionError(null, '页面结构没读出来，请重试。');
    }
    return page;
  }

  private async shot(tabId: string, step: StepReporter): Promise<Record<string, unknown>> {
    const tab = this.tab(tabId);
    step('读标签的视口大小');
    const size = await this.call(tabId, 'viewport', {});
    const width = Number(size.width);
    const height = Number(size.height);
    step('截标签画面');
    let image = await within(tab.view.webContents.capturePage(undefined, { stayHidden: true }), CAPTURE_MS);
    if ((image === null || image.isEmpty()) && !tab.view.getVisible()) {
      step('标签在后台：垫到最底层短暂显示再截');
      image = await this.shotFromBottom(tab);
    }
    if (image === null || image.isEmpty()) {
      throw new TabActionError(null, '这个标签现在截不到画面（可能还没载入完），过一会儿再试。');
    }
    step('压成 JPEG');
    const jpeg = image.resize({ width, height }).toJPEG(SHOT_QUALITY).toString('base64');
    return { tabId, url: tab.view.webContents.getURL(), jpeg, width, height };
  }

  private async shotFromBottom(tab: Tab): Promise<NativeImage | null> {
    this.deps.tabs.toBottom(tab.id);
    tab.view.setVisible(true);
    try {
      tab.view.webContents.invalidate();
      await sleep(BOTTOM_SETTLE_MS);
      return await within(tab.view.webContents.capturePage(), CAPTURE_MS);
    } finally {
      if (this.viewing() !== tab.id) {
        tab.view.setVisible(false);
      }
    }
  }

  private async wait(tabId: string, text: string, gone: boolean, timeoutMs: number, step: StepReporter)
    : Promise<Record<string, unknown>> {
    step(gone ? `等「${text.slice(0, 20)}」消失` : `等「${text.slice(0, 20)}」出现`);
    const started = Date.now();
    for (;;) {
      const facts = await this.call(tabId, 'contains', { text });
      const met = facts.found === !gone;
      const waitedMs = Date.now() - started;
      if (met || waitedMs >= timeoutMs) {
        return { tabId, met, waitedMs };
      }
      await sleep(WAIT_POLL_MS);
    }
  }

  private async point(tabId: string, x: number, y: number): Promise<Record<string, unknown>> {
    const tab = this.tab(tabId);
    this.present(tab);
    const target = await this.call(tabId, 'operate', { request: { op: 'at', x, y } });
    if (target.found !== true) {
      throw new TabActionError(null, '这个位置上没有能点的东西：先 tab_shot 再看一眼。');
    }
    if (typeof target.submit === 'string') {
      throw new DeviceRefused(`点到的是「${String(target.name)}」，像提交，按位置点不放行：先 tab_perceive 找到它的`
        + '编号，用 tab_act 点（发出去走 page_send）。');
    }
    const nonce = randomUUID();
    const before = digest(await this.call(tabId, 'state', { nonce, cleanup: false }));
    await trustedClick(tab.view.webContents, x, y);
    const after = await this.settled(tab, nonce);
    return { tabId, target: { tag: String(target.role), text: String(target.name) }, before, after,
      changed: after.digest !== before.digest || after.url !== before.url };
  }

  private async type(tabId: string, text: string): Promise<Record<string, unknown>> {
    const tab = this.tab(tabId);
    this.present(tab);
    const focused = await this.call(tabId, 'focused', {});
    if (focused.editable !== true) {
      throw new TabActionError(null, '现在没有能打字的焦点：先用 tab_point 点一下输入框。');
    }
    if (focused.password === true) {
      throw new DeviceRefused(FILL_ERRORS.password ?? '密码框不由 Plasticine 填。');
    }
    if (focused.card === true) {
      throw new DeviceRefused(FILL_ERRORS.card ?? '银行卡号这类不由 Plasticine 填。');
    }
    await trustedInsert(tab.view.webContents, text);
    const after = await this.call(tabId, 'focused', {});
    return { tabId, tag: String(after.tag), matches: String(after.text).includes(text.slice(0, MATCH_PREFIX)) };
  }

  private async key(tabId: string, key: string): Promise<Record<string, unknown>> {
    const tab = this.tab(tabId);
    this.present(tab);
    let stroke: KeyStroke;
    try {
      stroke = keyStroke(key, this.deps.platform);
    } catch (error) {
      if (error instanceof KeyRefused) throw new DeviceRefused(error.message);
      throw error;
    }
    if (stroke.code === 'Space' && (await this.call(tabId, 'focus-button', {})).button === true) {
      throw new DeviceRefused('焦点在按钮上，按空格等于点它：用 tab_act 按编号点（提交前问他）。');
    }
    const nonce = randomUUID();
    const before = digest(await this.call(tabId, 'state', { nonce, cleanup: false }));
    await trustedKey(tab.view.webContents, stroke);
    const after = await this.settled(tab, nonce);
    return { tabId, key, before, after, changed: after.digest !== before.digest || after.url !== before.url };
  }

  private async scroll(tabId: string, x: number, y: number, dy: number): Promise<Record<string, unknown>> {
    const tab = this.tab(tabId);
    this.present(tab);
    const before = Number((await this.call(tabId, 'scrolled', { x, y })).position);
    await trustedWheel(tab.view.webContents, x, y, dy);
    await sleep(SETTLE_MS);
    const after = Number((await this.call(tabId, 'scrolled', { x, y })).position);
    return { tabId, moved: after !== before };
  }

  private async paste(tabId: string, text: string, html: string | null): Promise<Record<string, unknown>> {
    const tab = this.tab(tabId);
    this.present(tab);
    const done = await this.call(tabId, 'paste', { text, html });
    if (done.password === true) {
      throw new DeviceRefused(FILL_ERRORS.password ?? '密码框不由 Plasticine 填。');
    }
    if (done.card === true) {
      throw new DeviceRefused(FILL_ERRORS.card ?? '银行卡号这类不由 Plasticine 填。');
    }
    if (done.editable !== true) {
      throw new TabActionError(null, '现在没有能粘贴的焦点：先用 tab_act 或 tab_point 点一下编辑区。');
    }
    await sleep(FILL_SETTLE_MS);
    return { tabId, tag: String(done.tag), handled: done.handled === true, matches: done.matches === true };
  }

  private async upload(action: Extract<DeviceActionParams, { kind: 'tab_upload' }>, step: StepReporter)
    : Promise<Record<string, unknown>> {
    const tab = this.tab(action.tabId);
    this.present(tab);
    const via = await uploadTo(tab.view.webContents, this.frames, tab.id, action, step);
    await sleep(SETTLE_MS);
    return { tabId: tab.id, files: action.files.map((file) => file.name), via };
  }

  private async act(action: Extract<DeviceActionParams, { kind: 'tab_act' }>): Promise<Record<string, unknown>> {
    const tab = this.tab(action.tabId);
    if (this.viewing() === tab.id && Date.now() - tab.lastInputAt < PRESENT_MS) {
      throw new TabActionError('user_present', '你正看着这个标签，Plasticine 等你停下来再做。');
    }
    const actionId = randomUUID();
    const report = (status: PageOperateEvent['status'], step: string): void => this.deps.operate({ type: 'operate',
      tabId: tab.id, actionId, status, step });
    report('run', action.step);
    const before = await this.perceive(tab.id);
    const route = this.frames.route(tab.id, action.version, 'n' in action.act ? action.act.n : undefined);
    const done = route === null ? { ok: false, error: 'stale' } : await this.frames.call(tab.id, route, 'operate', {
      request: { op: 'act', version: route.version, act: route.n === undefined ? action.act
        : { ...action.act, n: route.n }, allowSubmit: action.submitAsk !== null } }) as Record<string, unknown>;
    if (route !== null && typeof done.target === 'object' && done.target !== null) {
      const target = done.target as { n?: unknown };
      done.target = { ...target, n: typeof target.n === 'number' ? target.n + route.base : target.n };
    }
    if (done.ok !== true) {
      if (done.error === 'submit') {
        report('wait', '要提交了，等你定');
        throw new TabActionError('submit_needs_you', '这一下是提交，等你在卡上定。',
          { submit: done.submit ?? null, target: done.target ?? null });
      }
      if (done.error === 'stale') {
        report('err', '页面变了，重新看一遍');
        throw new TabActionError('page_stale', '页面变了，编号过期了，先重新感知。');
      }
      report('err', action.step);
      throw new TabActionError(null, FILL_ERRORS[String(done.error)] ?? '网页上这一下没做成，重新感知一下再试。');
    }
    if (action.act.op === 'click' || action.act.op === 'enter') {
      await sleep(SETTLE_MS);
      await this.waitLoad(tab);
    } else if (action.act.op === 'fill' || action.act.op === 'select') {
      await sleep(FILL_SETTLE_MS);
    }
    const after = await this.perceive(tab.id);
    report('done', action.step);
    const state = (page: Record<string, unknown>): Record<string, unknown> => ({ url: page.url, title: page.title,
      digest: page.digest });
    return { tabId: tab.id, op: action.act.op, target: done.target ?? null, before: state(before), after: state(after),
      changed: before.digest !== after.digest || before.url !== after.url,
      matches: typeof done.matches === 'boolean' ? done.matches : null, submitted: done.submitted ?? null,
      page: after };
  }
}
