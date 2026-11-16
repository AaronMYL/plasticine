// 网页标签上的设备动作（tab_list / read / open / navigate / click / fill / perceive / act），和 Mac 壳 tab-actions.swift、
// page-operate.swift 同一套：在他登录着的网页标签里按 DOM 做，不动真鼠标；点之前之后各读一次页面算摘要，changed 为真才
// 算点到（DOM 点不动、页面只认可信点击的，再用调试协议点一次）；填完读回值，matches 为真才算填对。判道两次：先按参数
// （device-guard），找到元素后再按它的真实 DOM（页面地址、表单地址、按钮上的字、autocomplete、密码框）判一次。他正
// 看着这个标签（窗口在前、它在中间、30 秒内动过键鼠）时点、填、操作都不做，回 user_present，本体等他停下来。
// 11-16：DOM 认不出的（会话列表一行这类）也在标签里后台做——tab_shot 截这个标签的画面（标签藏着也截，不切前台），
// tab_point 按画面上的位置发可信点击，tab_type 往焦点里打字；都不动他的真鼠标和窗口。按位置点到的像提交就不点。

import { createHash, randomUUID } from 'node:crypto';
import { Value } from 'typebox/value';
import { nativeImage } from 'electron';
import type { DeviceActionParams, PageOperateEvent } from '../../../agent/shared/api/index.ts';
import { PagePerceptionSchema } from '../../../agent/shared/api/page-operate.ts';
import { classifyLane, isPaymentPage } from '../../../agent/shared/device-lanes.ts';
import { DeviceRefused, TabActionError, type TabActionPort } from '../node/action-runner.ts';
import { trustedClick, trustedInsert, withDebugger } from './cdp.ts';
import type { Located, TargetFacts } from './tab-dom.ts';
import type { Tab, TabViews } from './tab-views.ts';

/** 他最近这么久内在这个标签里动过键鼠，就算正看着。 */
const PRESENT_MS = 30_000;
/** 点之后等页面动一下再读回；还在载入就等载入完，最多 10 秒（和 Mac 壳一样）。 */
const SETTLE_MS = 600;
const LOAD_WAIT_MS = 10_000;
/** tab_shot 的 JPEG 质量：看得清字、几百 KB。 */
const SHOT_QUALITY = 80;
/** 打完字读回时核对开头这么多字（读回最多 8000 字，长文只比开头）。 */
const MATCH_PREFIX = 200;

export interface TabActionDeps {
  tabs: TabViews;
  /** 主窗口在前台、看得见。 */
  windowFocused(): boolean;
  confirm(message: string): Promise<boolean>;
  /** 对话框里列出 Plasticine 在这一页做的一步。 */
  operate(event: PageOperateEvent): void;
}

const FILL_ERRORS: Readonly<Record<string, string>> = {
  missing: '页面上找不到要填的那个框了。',
  disabled: '这个框现在不能填（禁用或只读）。',
  option: '下拉框里没有这一项。',
  unfillable: '这个元素不是输入框或下拉框，填不进去。',
  password: '密码框不由 Plasticine 填：请你自己填。',
  card: '银行卡号、安全码这类不由 Plasticine 填。',
};

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

  constructor(deps: TabActionDeps) {
    this.deps = deps;
  }

  available(): boolean {
    return true;
  }

  /** 他此刻正看着的标签 id（窗口在前、在中间区）；没有是 null。 */
  viewing(): string | null {
    const active = this.deps.tabs.active;
    return active !== null && this.deps.windowFocused() && this.deps.tabs.frame !== null ? active.id : null;
  }

  async run(action: DeviceActionParams): Promise<Record<string, unknown>> {
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
        return this.shot(action.tabId);
      case 'tab_point':
        return this.point(action.tabId, action.x, action.y);
      case 'tab_type':
        return this.type(action.tabId, action.text);
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

  /** 找到元素后按真实 DOM 再判一次道：付款页、付款按钮、卡号框关死，密码框要他点。 */
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
      // 页面只认可信点击（isTrusted）的，用调试协议在元素中心再点一次。
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
    const page = await this.call(tabId, 'operate', { request: { op: 'perceive' } });
    if (!Value.Check(PagePerceptionSchema, page)) {
      throw new TabActionError(null, '页面结构没读出来，请重试。');
    }
    return page;
  }

  /** 截这个标签的画面，缩到视口的 CSS 像素（tab_point 的坐标照它）；标签藏着也截，不让它露出来。 */
  private async shot(tabId: string): Promise<Record<string, unknown>> {
    const tab = this.tab(tabId);
    const size = await this.call(tabId, 'viewport', {});
    const width = Number(size.width);
    const height = Number(size.height);
    let image = await tab.view.webContents.capturePage(undefined, { stayHidden: true });
    if (image.isEmpty()) {
      const data = await withDebugger(tab.view.webContents, async (send) =>
        (await send('Page.captureScreenshot', { format: 'png', fromSurface: true }) as { data: string }).data);
      image = nativeImage.createFromBuffer(Buffer.from(data, 'base64'));
    }
    if (image.isEmpty()) {
      throw new TabActionError(null, '这个标签现在截不到画面（可能还没载入完），过一会儿再试。');
    }
    const jpeg = image.resize({ width, height }).toJPEG(SHOT_QUALITY).toString('base64');
    return { tabId, url: tab.view.webContents.getURL(), jpeg, width, height };
  }

  /** 按画面上的位置点一下：先认点到的是什么，像提交的不点；点用调试协议发可信点击，不动真鼠标。 */
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

  /** 往焦点里打字（输入法那条路，React 这类页面也认）；密码框、卡号框不打；不按回车。 */
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
    const done = await this.call(tab.id, 'operate', { request: { op: 'act', version: action.version,
      act: action.act, allowSubmit: action.submitAsk !== null } });
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
