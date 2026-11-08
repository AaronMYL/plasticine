import AppKit
import ServiceManagement

@MainActor
final class AppDelegate: NSObject, NSApplicationDelegate, NSMenuDelegate {
    private let settings = AppSettings()
    private let notifications = NotificationManager()
    private let shortcut = GlobalShortcut()
    private lazy var service = NodeService(settings: settings)
    /// 「这台 Mac」模式下 App 自己起的服务（local-server.swift）。
    private let localServer = LocalServer()
    private lazy var updater = SelfUpdate(settings: settings)
    private lazy var xTimeline = XTimelineReader(settings: settings)
    private lazy var browser = WebWindow(settings: settings, notifications: notifications)
    private lazy var folders = FoldersWindow(settings: settings)
    private lazy var pairing = PairingWindow(service: service)
    private lazy var preferences = SettingsWindow(
        settings: settings, service: service, updater: updater, notifications: notifications, shortcut: shortcut
    )
    private var statusItem: NSStatusItem?
    private var serviceItem: NSMenuItem?
    private var updateItem: NSMenuItem?
    private var localServerItem: NSMenuItem?
    private var rollbackItem: NSMenuItem?
    private var loginItem: NSMenuItem?
    private var terminating = false
    private var terminateReplied = false
    /// 退出时等设备服务收尾的上限（秒）。
    private static let shutdownSeconds: UInt64 = 5
    /// 开始退出后进程还在的最后时限（秒）：主线程卡住、收尾回不来时由 ExitWatchdog 直接结束进程。
    private static let exitWatchdogSeconds: TimeInterval = 10

    func applicationDidFinishLaunching(_ notification: Notification) {
        buildMenus()
        browser.show()
        notifications.onOpen = { [weak self] hash in self?.browser.navigate(hash: hash) }
        shortcut.onPress = { [weak self] in self?.newConversation() }
        preferences.onServerChange = { [weak self] in
            self?.browser.pending.removeAll()
            self?.browser.pendingHash = nil
            self?.applyServerMode(reload: true)
        }
        localServer.onChange = { [weak self] in self?.updateStatus() }
        preferences.onFolders = { [weak self] in self?.folders.show() }
        preferences.onPair = { [weak self] in self?.pairing.show() }
        folders.onChange = { [weak self] in self?.preferences.refresh() }
        service.onChange = { [weak self] in self?.updateStatus() }
        service.attachWebTabs(browser.tabs)
        updater.isBusy = { [weak self] in self?.service.isExecuting ?? false }
        updater.onChange = { [weak self] in self?.updateStatus() }
        // 第 5 条：先结束还活着的旧版（更新后旧版关不掉），再占快捷键、起设备服务、清上一版备份，
        // 免得两个实例抢同一把快捷键、同一份回执，或删掉旧版正跑着的那份 App。没有旧版时立刻往下走。
        Task {
            await SingleInstance.endOlderInstances()
            startServices()
        }
    }

    private func startServices() {
        guard !terminating else { return }
        do { try shortcut.register(settings.shortcut) }
        catch { NativePrompts.show(error.localizedDescription) }
        applyServerMode(reload: false)
        service.restart()
        updater.startAutomaticChecks()
        xTimeline.start()
        if Bundle.main.bundleURL.pathExtension == "app" {
            // 旧安装启动后清理一次性备份（应用程序里只留一个 Plasticine）。
            // 带服务清单的新版 App 留着上一版供回退；选择远程实例也保留，不放在「应用程序」里。
            let app = Bundle.main.bundleURL
            let keepPrevious = updater.keepsPreviousVersion
            DispatchQueue.global(qos: .utility).async {
                // 先把 Dock 认的那个文件夹接回来（旧安装器装的这一版才需要），再清备份。
                DockReattach.reattach(app: app)
                SelfUpdateInstaller.removeLeftoverBackups(besides: app, keepPrevious: keepPrevious)
            }
        }
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { false }

    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool {
        browser.show()
        return true
    }

    func applicationShouldTerminate(_ sender: NSApplication) -> NSApplication.TerminateReply {
        // 第 5 条：上一次退出还在收尾时又点退出（或新版来结束这个旧实例），不再等，立刻退。
        if terminating { return .terminateNow }
        terminating = true
        ExitWatchdog.arm(after: Self.exitWatchdogSeconds)
        updater.stop()
        xTimeline.stop()
        shortcut.close()
        browser.removePointerMonitor()
        // 设备服务收尾（取消长轮询和在跑的命令）和本机服务收尾一起做，最多等这么久，到点不管收没收完都退。
        // 本机服务没收完也不要紧：App 一退，它的 stdin 就断了，它自己收尾。
        Task {
            let server = Task { await localServer.stop() }
            await service.shutdown()
            await server.value
            finishTerminating(sender)
        }
        Task {
            try? await Task.sleep(nanoseconds: Self.shutdownSeconds * 1_000_000_000)
            finishTerminating(sender)
        }
        return .terminateLater
    }

    private func finishTerminating(_ sender: NSApplication) {
        guard !terminateReplied else { return }
        terminateReplied = true
        sender.reply(toApplicationShouldTerminate: true)
    }

    func application(_ application: NSApplication, open urls: [URL]) {
        browser.show()
        Task {
            do {
                let payload = try await Task.detached(priority: .userInitiated) { try FileAttachments.read(urls) }.value
                browser.invoke("__plasticineAttachFiles", arguments: [payload])
            } catch { NativePrompts.show("附加文件失败：\(error.localizedDescription)") }
        }
    }

    func menuNeedsUpdate(_ menu: NSMenu) { updateStatus() }

    @objc private func openWindow() { browser.show() }
    @objc private func openSettings() { preferences.show() }
    @objc private func reload() {
        if browser.tabs.reloadFocused() { return }
        if browser.webView.url == nil { browser.loadServer() }
        else { browser.webView.reload() }
    }
    @objc private func quit() { NSApp.terminate(nil) }
    @objc private func showPairing() { pairing.show() }
    @objc private func showFolders() { folders.show() }
    @objc private func toggleService() { service.toggle() }
    @objc private func newConversation() { browser.invoke("__plasticineFocusComposer") }
    @objc private func newNote() { browser.invoke("__plasticineNewNote") }
    @objc private func checkUpdate() { Task { await updater.check() } }
    @objc private func rollBack() { Task { await updater.rollback() } }

    /// 按设置起停本机服务，窗口指过去。「这台 Mac」：等服务答上健康检查再载入，第一次开库要几秒。
    /// reload：远程模式下要不要重新载入（启动时窗口已经在载入了，不重复）。
    private func applyServerMode(reload: Bool) {
        guard settings.mode == .thisMac else {
            Task { await localServer.stop() }
            if reload { browser.loadServer() }
            return
        }
        localServer.start()
        Task {
            if await LocalServer.waitHealthy() { browser.loadServer() }
            else { NativePrompts.show("本机服务一分钟内没起来。日志在 ~/Library/Logs/Plasticine/server.log。") }
        }
    }
    @objc private func findInPage() { browser.webMenu("find") }
    @objc private func printPage() { browser.webMenu("print") }
    @objc private func showHistory() { browser.webMenu("history") }

    @objc private func toggleLogin() {
        Task {
            do {
                if SMAppService.mainApp.status == .enabled {
                    try await SMAppService.mainApp.unregister()
                } else if SMAppService.mainApp.status == .requiresApproval {
                    SMAppService.openSystemSettingsLoginItems()
                } else {
                    try SMAppService.mainApp.register()
                    if SMAppService.mainApp.status == .requiresApproval { SMAppService.openSystemSettingsLoginItems() }
                }
                updateStatus()
            } catch { NativePrompts.show("登录项修改失败，请先安装到 ~/Applications，再到系统设置中检查登录项。") }
        }
    }

    private func buildMenus() {
        let main = NSMenu()
        let app = NSMenu(title: "Plasticine")
        let appRoot = NSMenuItem()
        appRoot.submenu = app
        main.addItem(appRoot)
        let about = NSMenuItem(
            title: "关于 Plasticine", action: #selector(NSApplication.orderFrontStandardAboutPanel(_:)), keyEquivalent: ""
        )
        about.target = NSApp
        app.addItem(about)
        app.addItem(item("设置…", #selector(openSettings), key: ","))
        app.addItem(item("重新载入", #selector(reload), key: "r"))
        app.addItem(.separator())
        app.addItem(item("退出 Plasticine", #selector(quit), key: "q"))
        let edit = NSMenu(title: "编辑")
        for (title, selector, key) in [("剪切", "cut:", "x"), ("复制", "copy:", "c"),
                                       ("粘贴", "paste:", "v"), ("全选", "selectAll:", "a")] {
            edit.addItem(NSMenuItem(title: title, action: Selector(selector), keyEquivalent: key))
        }
        let editRoot = NSMenuItem(title: "编辑", action: nil, keyEquivalent: "")
        editRoot.submenu = edit
        main.addItem(editRoot)
        // 第 2 批「浏览器」：键盘在网页标签（原生网页）里时主网页收不到 ⌘F / ⌘P / ⌘Y，由这几项交给网页界面。
        let page = NSMenu(title: "网页")
        page.addItem(item("在页面中查找", #selector(findInPage), key: "f"))
        page.addItem(item("存成 PDF / 打印", #selector(printPage), key: "p"))
        page.addItem(item("历史记录", #selector(showHistory), key: "y"))
        let pageRoot = NSMenuItem(title: "网页", action: nil, keyEquivalent: "")
        pageRoot.submenu = page
        main.addItem(pageRoot)
        NSApp.mainMenu = main

        let status = NSStatusBar.system.statusItem(withLength: NSStatusItem.squareLength)
        status.button?.image = NSImage(named: "MenuIconTemplate")
        status.button?.image?.size = NSSize(width: 18, height: 18)
        status.button?.image?.isTemplate = true
        status.button?.setAccessibilityLabel("Plasticine")
        let menu = NSMenu()
        menu.delegate = self
        menu.addItem(item("打开 Plasticine", #selector(openWindow)))
        menu.addItem(item("新对话", #selector(newConversation)))
        menu.addItem(item("新笔记", #selector(newNote)))
        menu.addItem(.separator())
        let device = item("设备服务：正在连接", #selector(toggleService))
        menu.addItem(device)
        serviceItem = device
        menu.addItem(item("配对这台 Mac…", #selector(showPairing)))
        menu.addItem(item("授权目录…", #selector(showFolders)))
        let login = item("登录时启动", #selector(toggleLogin))
        menu.addItem(login)
        loginItem = login
        menu.addItem(.separator())
        let local = NSMenuItem(title: "本机服务：已停止", action: nil, keyEquivalent: "")
        local.isEnabled = false
        menu.addItem(local)
        localServerItem = local
        menu.addItem(item("检查更新", #selector(checkUpdate)))
        let back = item("回到上一版", #selector(rollBack))
        menu.addItem(back)
        rollbackItem = back
        let updateInfo = NSMenuItem(title: "更新：尚未检查", action: nil, keyEquivalent: "")
        updateInfo.isEnabled = false
        menu.addItem(updateInfo)
        updateItem = updateInfo
        menu.addItem(.separator())
        menu.addItem(item("退出 Plasticine", #selector(quit)))
        status.menu = menu
        statusItem = status
    }

    private func item(_ title: String, _ action: Selector, key: String = "") -> NSMenuItem {
        let result = NSMenuItem(title: title, action: action, keyEquivalent: key)
        result.target = self
        return result
    }

    private func updateStatus() {
        let state = service.needsPairing ? "需要重新配对" : service.state
        serviceItem?.title = "设备服务：" + String(state.prefix(40))
        serviceItem?.state = settings.paused ? .off : .on
        updateItem?.title = "更新：" + String(updater.stateText.prefix(60))
        let local = settings.mode == .thisMac
        localServerItem?.isHidden = !local
        localServerItem?.title = "本机服务：" + String(localServer.stateText.prefix(40))
        rollbackItem?.isHidden = !(updater.keepsPreviousVersion && updater.canRollBack)
        loginItem?.state = SMAppService.mainApp.status == .enabled ? .on : .off
        statusItem?.button?.toolTip = "Plasticine · " + state
    }
}
