import AppKit

@MainActor
final class SettingsWindow: NSObject, NSWindowDelegate {
    private let settings: AppSettings
    private let service: NodeService
    private let updater: SelfUpdate
    private let notifications: NotificationManager
    private let shortcut: GlobalShortcut
    private let window: NSWindow
    private let connection = NativeLayout.label("")
    private let screen = NativeLayout.label("")
    private let accessibility = NativeLayout.label("")
    private let notification = NativeLayout.label("")
    private let roots = NativeLayout.label("")
    private let update = NativeLayout.label("")
    private let server = NSTextField()
    private let mode = NSPopUpButton()
    private let shortcutField = ShortcutField()
    private var timer: Timer?
    var onServerChange: (() -> Void)?
    var onFolders: (() -> Void)?
    var onPair: (() -> Void)?

    init(settings: AppSettings, service: NodeService, updater: SelfUpdate,
         notifications: NotificationManager, shortcut: GlobalShortcut) {
        self.settings = settings
        self.service = service
        self.updater = updater
        self.notifications = notifications
        self.shortcut = shortcut
        window = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 640, height: 620),
            styleMask: [.titled, .closable], backing: .buffered, defer: false
        )
        super.init()
        window.title = "Plasticine 设置"
        window.isReleasedWhenClosed = false
        window.delegate = self
        window.center()
        build()
    }

    private func build() {
        let column = NativeLayout.column(in: window)
        column.addArrangedSubview(connection)
        column.addArrangedSubview(NativeLayout.row([
            NativeLayout.button("暂停 / 恢复设备服务", target: self, action: #selector(toggle)),
            NativeLayout.button("配对这台 Mac…", target: self, action: #selector(pair))
        ]))
        column.addArrangedSubview(NativeLayout.row([
            screen, NativeLayout.button("去打开", target: self, action: #selector(openScreen))
        ]))
        column.addArrangedSubview(NativeLayout.row([
            accessibility, NativeLayout.button("去打开", target: self, action: #selector(openAccessibility))
        ]))
        column.addArrangedSubview(NativeLayout.row([
            notification, NativeLayout.button("去打开", target: self, action: #selector(openNotifications))
        ]))
        column.addArrangedSubview(roots)
        column.addArrangedSubview(NativeLayout.button("授权目录…", target: self, action: #selector(folders)))
        column.addArrangedSubview(NativeLayout.label("服务器"))
        mode.addItems(withTitles: [ServerMode.thisMac.title, ServerMode.remote.title])
        mode.item(at: 0)?.isEnabled = BundledServer.available
        mode.autoenablesItems = false
        mode.target = self
        mode.action = #selector(changeMode)
        column.addArrangedSubview(mode)
        server.stringValue = settings.remoteServer.absoluteString
        server.placeholderString = "https://主机名或IP[:端口]/"
        server.widthAnchor.constraint(equalToConstant: 440).isActive = true
        column.addArrangedSubview(NativeLayout.row([
            server, NativeLayout.button("保存", target: self, action: #selector(saveServer))
        ]))
        column.addArrangedSubview(NativeLayout.label("全局快捷键：点输入框，按含 ⌘、⌥ 或 ⌃ 的组合键。"))
        shortcutField.stringValue = settings.shortcut.label
        shortcutField.widthAnchor.constraint(equalToConstant: 240).isActive = true
        shortcutField.onRecord = { [weak self] value in self?.record(value) }
        column.addArrangedSubview(NativeLayout.row([
            shortcutField, NativeLayout.button("恢复 ⌥Space", target: self, action: #selector(resetShortcut))
        ]))
        column.addArrangedSubview(NativeLayout.label("网页登录与 Mac 节点配对分别进行；关窗口后，设备服务仍继续运行。"))
        column.addArrangedSubview(update)
        column.addArrangedSubview(NativeLayout.button("检查更新", target: self, action: #selector(checkUpdate)))
        column.addArrangedSubview(NativeLayout.label(
            "自更新用本机「Plasticine Local Signing」自签证书重签；第一次重签时系统会问一次，请选「始终允许」。"
        ))
    }

    func show() {
        server.stringValue = settings.remoteServer.absoluteString
        showMode()
        refresh()
        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
        timer?.invalidate()
        timer = Timer.scheduledTimer(withTimeInterval: 2, repeats: true) { [weak self] _ in
            Task { @MainActor in self?.refresh() }
        }
    }

    func refresh() {
        let date = service.lastConnection.map {
            DateFormatter.localizedString(from: $0, dateStyle: .short, timeStyle: .medium)
        } ?? "尚未连接"
        connection.stringValue = "设备服务：\(service.state)\n节点名：\(settings.nodeName)\n最近一次连接：\(date)"
        screen.stringValue = "屏幕录制：" + (Permissions.screen ? "已允许" : "未允许")
        accessibility.stringValue = "辅助功能：" + (Permissions.accessibility ? "已允许" : "未允许")
        roots.stringValue = "授权目录：" + (settings.roots.isEmpty ? "无" : settings.roots.joined(separator: "、"))
        roots.maximumNumberOfLines = 2
        update.stringValue = "更新：" + updater.stateText
        update.maximumNumberOfLines = 2
        Task { notification.stringValue = "通知：" + (await notifications.permissionName()) }
    }

    func windowWillClose(_ notification: Notification) {
        timer?.invalidate()
        timer = nil
    }
    @objc private func toggle() {
        service.toggle()
        refresh()
    }
    @objc private func pair() { onPair?() }
    @objc private func folders() { onFolders?() }
    @objc private func checkUpdate() { Task { await updater.check(); refresh() } }
    @objc private func openScreen() { Permissions.requestScreen() }
    @objc private func openAccessibility() { Permissions.requestAccessibility() }
    @objc private func resetShortcut() { record(.standard) }

    @objc private func openNotifications() {
        Task {
            _ = await notifications.request()
            Permissions.openSettings("com.apple.preference.notifications")
            refresh()
        }
    }

    @objc private func saveServer() {
        do {
            settings.remoteServer = try ServerAddress.parse(server.stringValue)
            settings.mode = .remote
            showMode()
            service.restart()
            onServerChange?()
            server.stringValue = settings.remoteServer.absoluteString
        } catch { NativePrompts.show(error.localizedDescription) }
    }

    @objc private func changeMode() {
        let chosen: ServerMode = mode.indexOfSelectedItem == 0 ? .thisMac : .remote
        guard chosen != settings.mode else { return }
        settings.mode = chosen
        showMode()
        service.restart()
        onServerChange?()
    }

    private func showMode() {
        mode.selectItem(at: settings.mode == .thisMac ? 0 : 1)
        server.isEnabled = settings.mode == .remote
    }

    private func record(_ value: Shortcut) {
        do {
            try shortcut.register(value)
            settings.shortcut = value
            shortcutField.stringValue = value.label
            window.makeFirstResponder(nil)
        } catch {
            do { try shortcut.register(settings.shortcut) }
            catch { NativePrompts.show("原快捷键也无法注册，请重新选择组合键。") }
            NativePrompts.show("快捷键被占用，请试一个不同的组合。")
        }
    }
}
