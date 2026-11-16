// 网页标签上的设备动作（tab_list / read / open / navigate / click / fill / perceive / act），和 Mac 壳 tab-actions.swift、
// page-operate.swift 同一套：在他登录着的网页标签里按 DOM 做，不动真鼠标；点之前之后各读一次页面算摘要，changed 为真才
// 算点到（DOM 点不动、页面只认可信点击的，再用调试协议点一次）；填完读回值，matches 为真才算填对。判道两次：先按参数
// （device-guard），找到元素后再按它的真实 DOM（页面地址、表单地址、按钮上的字、autocomplete、密码框）判一次。他正
// 看着这个标签（窗口在前、它在中间、30 秒内动过键鼠）时点、填、操作都不做，回 user_present，本体等他停下来。
// 11-16：DOM 认不出的（会话列表一行这类）也在标签里后台做——tab_shot 截这个标签的画面（标签藏着也截，不切前台），
// tab_point 按画面上的位置发可信点击，tab_type 往焦点里打字；都不动他的真鼠标和窗口。按位置点到的像提交就不点。
// 11-16 能力总表：tab_key 按键（回车不按、碰剪贴板的不按）、tab_scroll 按位置滚、tab_paste 带格式粘贴（不碰系统
// 剪贴板）、tab_show 把标签切到他眼前（他接手一步）、tab_upload 往上传框放文件（接管「选择文件」，不弹给他）。

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
import { placeFiles } from './tab-upload.ts';
import type { Located, TargetFacts } from './tab-dom.ts';
import type { Tab, TabViews } from './tab-views.ts';

/** 他最近这么久内在这个标签里动过键鼠，就算正看着。 */
const PRESENT_MS = 30_000;
/** 点之后等页面动一下再读回；还在载入就等载入完，最多 10 秒（和 Mac 壳一样）。 */
const SETTLE_MS = 600;
const FILL_SETTLE_MS = 400;
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
  /** 把这个标签切到他眼前（窗口提到前面）。 */
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

/** 截一次画面最多等这么久；Electron 的截图在画面出不来时可能一直不返回。 */
const CAPTURE_MS = 8_000;
/** tab_wait 隔多久看一次。 */
const WAIT_POLL_MS = 500;
/** 垫到最底层显示出来以后等一帧画好。 */
const BOTTOM_SETTLE_MS = 200;

/** 等一个可能永远不返回的承诺，到点回 null（那个承诺放着不管）。 */
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
  /**
   * 截这个标签的画面，不切前台。11-16：隐藏的标签上用调试协议截图会一直不返回（18:48 那次整台设备卡住就在这里），
   * 所以不再走调试协议：先照常截；截到空图，就把这个标签垫到最底层、短暂设为可见再截一次（在 Plasticine 界面和
   * 正在看的标签后面），截完照原样藏回去。每一步都有时限。
   */
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
      // 期间他切过来看这个标签了就别藏。
      if (this.viewing() !== tab.id) {
        tab.view.setVisible(false);
      }
    }
  }

  /** 等一段字在页面上出现（或消失）：每半秒看一次，最多等 timeoutMs；回执说等到没有。 */
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

  /** 按一个键或组合键：回车不在能按的里面（schema 拦）；碰剪贴板的不按；焦点在按钮上不按空格（等于点它）。 */
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

  /** 在画面这个位置滚（可信滚轮）：滚的是指着的那一块（会话列表、弹窗里的长列表）。 */
  private async scroll(tabId: string, x: number, y: number, dy: number): Promise<Record<string, unknown>> {
    const tab = this.tab(tabId);
    this.present(tab);
    const before = Number((await this.call(tabId, 'scrolled', { x, y })).position);
    await trustedWheel(tab.view.webContents, x, y, dy);
    await sleep(SETTLE_MS);
    const after = Number((await this.call(tabId, 'scrolled', { x, y })).position);
    return { tabId, moved: after !== before };
  }

  /** 往焦点里粘贴：编辑器自己接住照它的排版；不碰系统剪贴板。密码框、卡号框不粘。 */
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

  /** 往编号 n 的上传框放文件（tab-upload.ts）：先认出这个编号是文件框还是「上传」按钮。 */
  private async upload(action: Extract<DeviceActionParams, { kind: 'tab_upload' }>, step: StepReporter)
    : Promise<Record<string, unknown>> {
    const tab = this.tab(action.tabId);
    this.present(tab);
    const nonce = randomUUID();
    const mark = await this.call(tab.id, 'operate', { request: { op: 'mark', version: action.version, n: action.n,
      nonce } });
    if (mark.found !== true) {
      throw new TabActionError('page_stale', '页面变了，编号过期了，先重新感知。');
    }
    if (mark.file === true && mark.multiple !== true && action.files.length > 1) {
      throw new TabActionError(null, '这个上传框一次只收一个文件：分几次传。');
    }
    const via = await placeFiles(tab.view.webContents, mark, nonce, action.files, step);
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
    } else if (action.act.op === 'fill' || action.act.op === 'select') {
      // 填完网页常会再改一次自己（发送按钮变可用、草稿出现）：等它改完再读回，回给脑的那一版编号才是稳的。
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
