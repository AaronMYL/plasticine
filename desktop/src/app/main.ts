// 桌面客户端（Mac、Windows 共用一套 Electron 壳，《优化清单》第 14 条）的主进程入口：把各块装起来。
// 窗口（main-window）· 本体跑在哪与本机本体（server-target、local-server）· 应用内浏览器（tabs/）· 登录（logins/）·
// 设备服务（node/）· 系统助手（helper/）· 信息流取数（feeds/）· 自更新（updates/）· 界面接口（bridge-ipc、ui-events）。

import { homedir, hostname } from 'node:os';
import { join } from 'node:path';
import { app, dialog, Notification, powerMonitor, safeStorage, session, shell } from 'electron';
import type { DesktopEvent } from '../../../agent/shared/api/desktop-bridge.ts';
import { FeedRunner, readPageScript } from '../feeds/feed-runner.ts';
import { HelperProcess } from '../helper/helper-process.ts';
import { Logins } from '../logins/logins.ts';
import { ActionJournal } from '../node/action-journal.ts';
import { DeviceActionRunner } from '../node/action-runner.ts';
import { CredentialStore } from '../node/credential-store.ts';
import { DeviceGuard } from '../node/device-guard.ts';
import { NodeApi } from '../node/node-api.ts';
import { NodeService } from '../node/node-service.ts';
import { realPathSystem } from '../node/path-policy.ts';
import { TabActions } from '../tabs/tab-actions.ts';
import { shellAgent, tabUserAgent } from '../tabs/tab-agent.ts';
import type { ForwardedMouse } from '../tabs/tab-input.ts';
import { runTool, SHELL_TOOLS } from '../tabs/tab-tools.ts';
import { TabFavicons } from '../tabs/tab-favicon.ts';
import { TabTranslate } from '../tabs/tab-translate.ts';
import { TabViews } from '../tabs/tab-views.ts';
import { adoptLocalSigning } from '../updates/adopt-signing.ts';
import { resign, signedLocally } from '../updates/self-signing.ts';
import { DEFAULT_RELEASE_URL, UpdateManager } from '../updates/update-manager.ts';
import { enterLocal, localGrantFor, probePlace } from './account-client.ts';
import { installMenu, installTray, type MenuActions, type MenuState } from './app-menu.ts';
import { registerBridge } from './bridge-ipc.ts';
import { CHANNELS } from './channels.ts';
import { desktopPaths, type ShellPlatform } from './desktop-paths.ts';
import { legacyChoice } from './legacy-settings.ts';
import { LocalServer } from './local-server.ts';
import { MainWindow } from './main-window.ts';
import { OAuthCapture } from './oauth-capture.ts';
import { openPermission } from './permissions.ts';
import { fetchBytes, launchDetached, launchServer, logger, readUrl, resources, runChecked, spawnHelper,
  waitHealthy } from './runtime.ts';
import { ServerPlace } from './server-place.ts';
import { defaultSettings, SettingsStore } from './settings-store.ts';
import { LOCAL_SERVER_URL, prefillRemote } from './server-target.ts';
import { UiEvents } from './ui-events.ts';
import { uiSession, webSession } from './web-session.ts';

const platform = process.platform as ShellPlatform;
const paths = desktopPaths(platform, { home: homedir(), ...(process.env.LOCALAPPDATA === undefined ? {}
  : { localAppData: process.env.LOCALAPPDATA }), ...(process.env.PLASTICINE_DESKTOP_USER_DATA === undefined ? {}
  : { userData: process.env.PLASTICINE_DESKTOP_USER_DATA }) });
app.setName('Plasticine');
app.setPath('userData', paths.userData);
const log = logger(paths.logs);

function confirmBox(window: MainWindow | null, message: string): Promise<boolean> {
  const options = { type: 'warning' as const, buttons: ['不做', '做'], defaultId: 0, cancelId: 0,
    message: 'Plasticine 要在这台电脑上做一件事', detail: message };
  const shown = window === null ? dialog.showMessageBox(options) : dialog.showMessageBox(window.window, options);
  return shown.then((answer) => answer.response === 1);
}

async function start(): Promise<void> {
  await app.whenReady();
  const version = app.getVersion();
  const bundle = join(process.execPath, '..', '..', '..');
  // 碰钥匙串之前先把自己换成本机证书签的那一份（签名身份固定，钥匙串尽量只弹一次）。
  if (platform === 'darwin' && app.isPackaged && await adoptLocalSigning({ app: bundle, version,
    directory: paths.updates, pid: process.pid, signedLocally, resign, launchDetached, log,
    copy: (from, to) => runChecked('/usr/bin/ditto', [from, to]) })) {
    app.exit(0);
    return;
  }
  const files = resources({ packaged: app.isPackaged, resourcesPath: process.resourcesPath, dist: __dirname,
    platform, env: process.env });
  const legacy = legacyChoice(platform, paths.root);
  // 第一次打开不替他选：开始页二选一；Swift 版存的远程地址只当「连到我的 Plasticine」的预填。
  const settings = new SettingsStore(paths.settingsFile, () => defaultSettings(prefillRemote(legacy.remote),
    homedir()), log);
  const tabAgent = tabUserAgent(app.userAgentFallback);
  const uiAgent = `${shellAgent(app.userAgentFallback)} PlasticineDesktop/${version}`;
  uiSession(uiAgent);
  const main = new MainWindow(platform, join(__dirname, 'preload-ui.cjs'), () => undefined);
  const ui = main.ui.webContents;
  const web = webSession(() => main.window, tabAgent);
  const local = new LocalServer({
    launch: (localToken) => launchServer({ node: files.node ?? '', server: files.server ?? '',
      state: paths.serverState, logs: paths.logs, platform, localToken }),
    healthy: waitHealthy, now: Date.now, log,
  }, files.server !== null && files.node !== null);
  const deviceName = hostname().slice(0, 60) || '这台电脑';
  const uiCookies = session.defaultSession.cookies;
  const place = new ServerPlace({ ui, settings, local, startPage: join(__dirname, 'start.html'),
    override: process.env.PLASTICINE_DESKTOP_URL ?? null, log,
    openExternal: (url) => void shell.openExternal(url),
    probe: (origin) => probePlace(origin, fetch),
    enterLocal: () => local.token === null ? Promise.resolve('') : enterLocal({ origin: LOCAL_SERVER_URL,
      token: local.token, deviceName, fetch, log, jar: {
        get: (url) => uiCookies.get({ url }),
        set: (details) => uiCookies.set(details),
      } }) });
  const capture = new OAuthCapture(log);
  const events = new UiEvents(() => ui, () => place.onSite(), log);
  const helper = new HelperProcess({ spawn: () => spawnHelper(files.helper), roots: () => settings.get().roots, log });
  let translate: TabTranslate | null = null;
  const favicons = new TabFavicons(web, (event) => events.send('__plasticineWebTabEvent', event), log);
  const tabs: TabViews = new TabViews({ window: main.window, ui: main.ui, session: web,
    preload: join(__dirname, 'preload-tab.cjs'), userAgent: tabAgent, log,
    emit: (event) => events.send('__plasticineWebTabEvent', event),
    pointer: () => events.send('__plasticineNativePointer'),
    loaded: () => undefined,
    cursor: (type) => ui.send(CHANNELS.tabsCursor, type),
    translate: (tab, message) => translate?.message(tab, message),
    favicon: (tab, urls) => favicons.update(tab, urls) });
  translate = new TabTranslate(tabs, (event) => events.send('__plasticineTranslateEvent', event), log);
  const tabTranslate = translate;
  const tabActions = new TabActions({ tabs, windowFocused: () => main.window.isFocused() && main.window.isVisible(),
    confirm: (message) => confirmBox(main, message),
    operate: (event) => events.send('__plasticineWebTabEvent', event) });
  const credentials = new CredentialStore(paths.credentials, platform === 'darwin' ? paths.legacyCredentials : null, {
    available: () => safeStorage.isEncryptionAvailable(),
    encrypt: (text) => safeStorage.encryptString(text),
    decrypt: (data) => safeStorage.decryptString(data),
  });
  const runner = new DeviceActionRunner({ helper, tabs: tabActions, guard: new DeviceGuard(),
    paths: realPathSystem(platform, homedir()), localRoots: () => settings.get().roots,
    confirm: (message) => confirmBox(main, message), openExternal: (url) => shell.openExternal(url), readUrl,
    trash: (path) => shell.trashItem(path),
    now: () => new Date(), log });
  const node = new NodeService({ api: (server) => new NodeApi(server, (input, init) => fetch(input, init)),
    credentials, journal: (server, nodeId) => new ActionJournal(paths.actions, server, nodeId), runner,
    identity: { name: deviceName, platform: platform === 'darwin' ? 'macos'
      : platform === 'win32' ? 'windows' : 'linux', appVersion: version },
    idleSeconds: async () => powerMonitor.getSystemIdleTime(), requestId: () => `desktop-${crypto.randomUUID()}`,
    sleep: (ms, signal) => new Promise((resolve) => {
      const timer = setTimeout(resolve, ms);
      signal.addEventListener('abort', () => { clearTimeout(timer); resolve(); }, { once: true });
    }), now: Date.now, log }, settings.get().devicePaused);
  const feeds = new FeedRunner({ session: web, userAgent: tabAgent, log,
    pageScript: (name) => readPageScript(join(__dirname, 'pages'), name),
    node: () => {
      const paired = node.status().state === 'online' ? node.credential() : null;
      return paired === null ? null : { api: new NodeApi(paired.server, fetch), credential: paired.credential };
    } });
  const updates = new UpdateManager({ platform, version, packaged: app.isPackaged,
    releaseUrl: process.env.PLASTICINE_DESKTOP_RELEASE_URL ?? DEFAULT_RELEASE_URL, directory: paths.updates,
    installed: platform === 'darwin' ? bundle : process.execPath, pid: process.pid,
    fetchBytes, extractZip: (zip, into) => runChecked('/usr/bin/ditto', ['-x', '-k', zip, into]), resign,
    launchDetached, quit: () => app.quit(), now: () => new Date(), log });
  const logins = new Logins({ session: web, platform, home: homedir(), localAppData: process.env.LOCALAPPDATA ?? null,
    sinceFile: join(app.getPath('userData'), 'logins-since.json'), now: () => new Date(), log });
  const desktopEvent = (event: DesktopEvent): void => events.send('__plasticineDesktopEvent', event);
  let menuState: (state: MenuState) => void = () => undefined;
  place.onChange((status) => {
    desktopEvent({ type: 'server', status });
    node.useServer(place.server());
    menuState({ thisComputer: place.thisComputer() });
  });
  updates.onChange((status) => desktopEvent({ type: 'update', status }));
  node.onChange((status) => desktopEvent({ type: 'device', status }));
  ui.on('did-finish-load', () => {
    if (place.onSite()) {
      updates.started();
    }
  });
  place.guardNavigation((url) => tabs.open(url, 'user', true));
  const notify = (title: string, body: string, hash: string): void => {
    if (!settings.get().notifications || !Notification.isSupported()) {
      return;
    }
    const notice = new Notification({ title, body });
    notice.on('click', () => {
      main.show();
      events.navigate(hash);
    });
    notice.show();
  };
  updates.onChange((status) => {
    if (status.state === 'ready' && status.available !== null) {
      notify('Plasticine 有新版本', `${status.available} 已下好，点这里重新打开就换上。`, '#/settings/system');
    }
  });
  // 进出全屏、最大化时报一次窗口外观；Windows 上带右上角窗口按钮的实际宽度（controlsRight，界面里按 Window
  // Controls Overlay 量出来）。
  const pushChrome = (): void => events.windowChrome(main.chrome(), platform === 'win32');
  for (const name of ['enter-full-screen', 'leave-full-screen', 'maximize', 'unmaximize'] as const) {
    main.window.on(name as 'maximize', pushChrome);
  }
  ui.on('did-finish-load', pushChrome);
  registerBridge({
    info: () => ({ version, platform: platform === 'darwin' ? 'macos' : platform === 'win32' ? 'windows' : 'linux',
      tools: [...SHELL_TOOLS] }),
    ui: () => ui, allowedOrigin: () => place.target(), startPage: () => place.startPageUrl(), notify,
    notificationsEnabled: () => settings.get().notifications,
    setNotifications: (enabled) => settings.update((value) => ({ ...value, notifications: enabled })).notifications,
    serverStatus: () => place.status(), chooseServer: (choice) => place.choose(choice),
    localGrant: (frameUrl) => localGrantFor(frameUrl, local.token),
    showWelcome: () => void place.welcome(),
    openExternal: (url) => void shell.openExternal(url),
    capture: (port, timeoutMs) => capture.capture(port, timeoutMs), cancelCapture: () => capture.cancel(),
    updateStatus: () => updates.status(), updateCheck: () => updates.check(),
    updateInstall: () => updates.install(), updateRollback: () => updates.rollback(),
    deviceStatus: () => node.status(), devicePair: (request) => node.pair(request.code),
    devicePause: (paused) => {
      settings.update((value) => ({ ...value, devicePaused: paused }));
      return node.pause(paused);
    },
    openPermission: (permission) => openPermission(platform, permission, helper, log),
    helperCall: (method, params) => helper.call(method, params as never),
    chromeCurrent: () => main.chrome(),
    tabsSync: (state) => tabs.sync(state), tabsCommand: (tabId, command) => {
      if (command === 'close') {
        tabTranslate.forget(tabId);
      }
      tabs.command(tabId, command);
    },
    tabsNavigate: (tabId, url) => tabs.navigate(tabId, url),
    tabsSnapshot: async (tabId) => ({ tabId, ...await tabs.call(tabId, 'snapshot') as object }),
    tabsTool: (tabId, tool) => runTool(tabs, tabId, tool),
    tabsInput: (input) => tabs.forward(input as unknown as ForwardedMouse),
    translateConfigure: (tabId, config) => tabTranslate.configure(tabId, config),
    translateDeliver: (tabId, delivery) => tabTranslate.deliver(tabId, delivery),
    loginsSites: () => logins.sites(), loginsSources: () => logins.sources(),
    loginsImport: (request) => logins.import(request), loginsForget: (host) => logins.forget(host),
    openFullDiskAccess: () => void shell.openExternal(
      'x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles'),
    log,
  });
  const actions: MenuActions = {
    show: () => main.show(),
    // 没登录（开始页、登录页、建账号页）时设置里没东西可改：回开始页，那里能换地方。
    settings: () => {
      main.show();
      void place.signedIn().then((signedIn) => (signedIn ? events.navigate('#/settings/system') : place.welcome()))
        .catch((error: unknown) => log(`没打开设置：${error instanceof Error ? error.message : String(error)}`));
    },
    connect: () => {
      main.show();
      void place.welcome();
    },
    resetPassword: () => {
      main.show();
      events.navigate('#/settings/account');
    },
    checkUpdates: () => void updates.check(),
    webMenu: (command) => events.send('__plasticineWebMenu', command),
    focusComposer: () => {
      main.show();
      events.send('__plasticineFocusComposer');
    },
    quit: () => app.quit(),
  };
  const menu = installMenu(platform, actions);
  const tray = installTray(platform, { color: files.icon, template: files.trayTemplate }, actions);
  let shownThisComputer: boolean | null = null;
  menuState = (state) => {
    if (state.thisComputer !== shownThisComputer) {
      shownThisComputer = state.thisComputer;
      menu(state);
      tray(state);
    }
  };
  menuState({ thisComputer: place.thisComputer() });
  app.on('second-instance', () => main.show());
  app.on('activate', () => main.show());
  let stopping = false;
  app.on('before-quit', (event) => {
    main.allowClose();
    if (stopping) {
      return;
    }
    event.preventDefault();
    stopping = true;
    node.stop();
    capture.cancel();
    feeds.stop();
    updates.stop();
    helper.stop();
    tabs.closeAll();
    void local.stop().finally(() => app.quit());
  });
  main.show();
  await place.load();
  node.useServer(place.server());
  feeds.start();
  updates.schedule();
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  start().catch((error: unknown) => {
    log(`客户端没起来：${error instanceof Error ? error.stack ?? error.message : String(error)}`);
    dialog.showErrorBox('Plasticine 没能打开', `${error instanceof Error ? error.message : String(error)}\n\n`
      + `日志在 ${paths.logs}`);
    app.exit(1);
  });
}
