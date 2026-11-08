import AppKit
import WebKit

@MainActor
final class WebWindow: NSObject, NSWindowDelegate {
    let window: NSWindow
    let webView: RoutedWebView
    let settings: AppSettings
    let downloads = WebDownloads()
    let bridge: WebBridge
    let tabsBridge: WebTabsBridge
    /// 第 3 批：登录的消息通道（logins-bridge.swift）。
    let loginsBridge: LoginsBridge
    let chromeBridge: WindowChromeBridge
    let translateBridge: WebTranslateBridge
    // 网页标签（第 102 条第 3 批）：原生 WKWebView，位置由网页界面同步来；0.3.0 起垫在透明的主网页下面。
    let tabs = WebTabs()
    // 交通灯并进网页顶栏（0.3.0）。
    let chrome: WindowChrome
    private let container = ChromeContainerView()
    private let dropRouter = DropRouterView()
    // 注入脚本要随窗口外观换（下一份文档开头就带上新值），留住同一个 userContentController。
    private let scripts: WKUserContentController
    /// 第 3 条（2026-11-05）：点落在网页标签上时告诉网页界面（nativePointer），浮层好收起。
    private var pointerMonitor: Any?
    var loaded = false
    var pending: [(String, [JSONValue])] = []
    var pendingHash: String?

    init(settings: AppSettings, notifications: NotificationManager) {
        self.settings = settings
        let bridge = WebBridge()
        self.bridge = bridge
        let tabsBridge = WebTabsBridge()
        self.tabsBridge = tabsBridge
        let loginsBridge = LoginsBridge()
        self.loginsBridge = loginsBridge
        let chromeBridge = WindowChromeBridge()
        self.chromeBridge = chromeBridge
        let translateBridge = WebTranslateBridge()
        self.translateBridge = translateBridge
        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = .default()
        configuration.applicationNameForUserAgent = "PlasticineMac/" + AppConstants.version
        let controller = configuration.userContentController
        controller.add(bridge, name: "plasticineMac")
        controller.add(chromeBridge, name: "plasticineChrome")
        controller.add(translateBridge, name: "plasticineTranslate")
        controller.addScriptMessageHandler(tabsBridge, contentWorld: .page, name: "plasticineTabs")
        controller.addScriptMessageHandler(loginsBridge, contentWorld: .page, name: "plasticineLogins")
        scripts = controller
        webView = RoutedWebView(frame: .zero, configuration: configuration)
        let window = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 1200, height: 800),
            styleMask: [.titled, .closable, .miniaturizable, .resizable], backing: .buffered, defer: false
        )
        self.window = window
        chrome = WindowChrome(window: window)
        super.init()
        window.title = "Plasticine"
        window.minSize = NSSize(width: 640, height: 480)
        window.isReleasedWhenClosed = false
        assembleContent()
        window.center()
        _ = window.setFrameUsingName("PlasticineMainWindow")
        window.setFrameAutosaveName("PlasticineMainWindow")
        window.delegate = self
        webView.navigationDelegate = self
        webView.uiDelegate = self
        bridge.owner = self
        bridge.notifications = notifications
        tabsBridge.owner = self
        loginsBridge.owner = self
        chromeBridge.owner = self
        translateBridge.owner = self
        tabs.owner = self
        chrome.zoom = { [weak self] in self?.zoom ?? 1 }
        chrome.onChange = { [weak self] state in self?.publishChrome(state) }
        installBridgeScript()
        installPointerMonitor()
        loadServer()
    }

    /// 网页标签是原生 WKWebView，点它时主网页收不到 pointerdown（window blur 也不一定来）：本地监视器看到按下落在
    /// 网页标签上，就报一声给网页界面。事件照常往下传，不吞。
    private func installPointerMonitor() {
        guard pointerMonitor == nil else { return }
        pointerMonitor = NSEvent.addLocalMonitorForEvents(
            matching: [.leftMouseDown, .rightMouseDown, .otherMouseDown]
        ) { [weak self] event in
            MainActor.assumeIsolated { if let self { self.notePointer(event) } }
            return event
        }
    }

    /// App 退出时调（主窗口关只是藏起来，不移除）。
    func removePointerMonitor() {
        guard let monitor = pointerMonitor else { return }
        NSEvent.removeMonitor(monitor)
        pointerMonitor = nil
    }

    private func notePointer(_ event: NSEvent) {
        // 和真点击走同一套分法（ChromeContainerView.hitTest）：落在主网页的浮层上、顶栏上的不算。
        guard loaded, event.window === window, let content = window.contentView,
              let hit = content.hitTest(event.locationInWindow), hit.isDescendant(of: tabs.host) else { return }
        nativePointer()
    }

    /// 只是个信号：不像 invoke 那样把窗口提到前面、等页面装好再补发；网页界面没装入口就什么也不做。
    private func nativePointer() {
        webView.callAsyncJavaScript("""
            if (typeof window.__plasticineNativePointer !== 'function') return false;
            window.__plasticineNativePointer();
            return true;
            """, arguments: [:], in: nil, in: .page) { _ in }
    }

    /// 内容视图从下到上：网页标签层、主网页、只认拖放的一层；点击、拖放、鼠标移动都按 ChromeHitRouter 分。
    private func assembleContent() {
        container.frame = window.contentRect(forFrameRect: window.frame)
        window.contentView = container
        for view in [webView, tabs.host, dropRouter] as [NSView] {
            view.frame = container.bounds
            view.autoresizingMask = [.width, .height]
            container.addSubview(view)
        }
        arrange(tabs.layering)
        container.mainView = webView
        container.tabLayer = tabs.host
        container.route = { [weak self] point in self?.route(containerPoint: point) ?? .main }
        container.onTitlebarMouseDown = { [weak self] event in self?.chrome.titlebarMouseDown(event) }
        webView.accepts = { [weak self] point in self?.route(windowPoint: point) != .tab }
        dropRouter.target = { [weak self] point in self?.dropTarget(windowPoint: point) }
        let common: [NSPasteboard.PasteboardType] = [.fileURL, .URL, .string, .html, .rtf, .png, .tiff]
        dropRouter.registerForDraggedTypes(Array(Set(webView.registeredDraggedTypes + common)))
        tabs.onLayeringChange = { [weak self] layering in self?.arrange(layering) }
        // 主网页不画底色：网页标签垫在下面，网页界面在网页标签那一块也不画底色，让它露出来。drawsBackground 没有
        // 公开的 setter，KVC 是 WebKit 认的做法；macOS 12 起橡皮筋回弹露出的底色另由 underPageBackgroundColor 管。
        webView.setValue(false, forKey: "drawsBackground")
        webView.underPageBackgroundColor = .clear
    }

    /// 新网页界面（sync 带 hitRegions）：网页标签垫到主网页下面；旧网页界面照 0.2.x 叠在上面。
    private func arrange(_ layering: WebTabLayering) {
        let mode: NSWindow.OrderingMode = layering == .underMain ? .below : .above
        container.addSubview(tabs.host, positioned: mode, relativeTo: webView)
        container.addSubview(dropRouter, positioned: .above, relativeTo: nil)
    }

    /// CSS 像素 → 原生点。
    var zoom: CGFloat { webView.pageZoom * webView.magnification }

    func route(containerPoint point: NSPoint) -> ChromeHitTarget {
        ChromeHitRouter.route(point, drag: chrome.dragZone, tab: tabs.shownRect, hitRegions: tabs.hitRects)
    }

    func route(windowPoint point: NSPoint) -> ChromeHitTarget {
        route(containerPoint: container.convert(point, from: nil))
    }

    private func dropTarget(windowPoint point: NSPoint) -> (ChromeHitTarget, NSView)? {
        switch route(windowPoint: point) {
        case .drag:
            return nil
        case .main:
            return (.main, webView)
        case .tab:
            guard let id = tabs.activeID, let tab = tabs.tab(id), !tab.view.isHidden else { return (.main, webView) }
            return (.tab, tab.view)
        }
    }

    /// 网页注入脚本带着当前的窗口外观：之后载入的文档一开头 windowChrome.current() 就是对的。
    private func installBridgeScript() {
        scripts.removeAllUserScripts()
        let source = BridgeScript.source(version: AppConstants.version, chrome: chrome.state)
        scripts.addUserScript(WKUserScript(source: source, injectionTime: .atDocumentStart, forMainFrameOnly: true))
    }

    /// 窗口外观变了（换外观、进出全屏）：告诉正开着的页面，并换掉注入脚本。
    private func publishChrome(_ state: WindowChromeState) {
        installBridgeScript()
        webView.callAsyncJavaScript("""
            if (typeof window.__plasticineNativeWindowChrome !== 'function') return false;
            window.__plasticineNativeWindowChrome(state);
            return true;
            """, arguments: ["state": state.json], in: nil, in: .page) { result in
            if case .failure(let error) = result {
                // 页面正在换文档时会失败；新文档开头的注入脚本已经带着新值，这里只记一笔。
                NSLog("Plasticine：窗口外观没能告诉网页：%@", error.localizedDescription)
            }
        }
    }

    /// 网页报了顶栏布局。第一次报时窗口换外观、内容视图长高到整个窗口，网页标签跟着重摆一次。
    func applyTitlebar(_ layout: TitlebarLayout) {
        chrome.apply(layout)
        tabs.layout()
    }

    func loadServer() {
        loaded = false
        webView.load(URLRequest(url: settings.server))
    }

    func show() {
        if window.isMiniaturized { window.deminiaturize(nil) }
        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
    }

    func windowShouldClose(_ sender: NSWindow) -> Bool {
        sender.orderOut(nil)
        return false
    }

    func invoke(_ name: String, arguments: [JSONValue] = []) {
        show()
        guard loaded else {
            pending.append((name, arguments))
            return
        }
        do {
            let data = try JSONEncoder().encode(arguments)
            let values = try JSONSerialization.jsonObject(with: data)
            webView.callAsyncJavaScript("""
                for (let i = 0; i < 150; i++) {
                  if (typeof window[name] === 'function') {
                    await window[name](...args);
                    return true;
                  }
                  await new Promise(resolve => setTimeout(resolve, 100));
                }
                return false;
                """, arguments: ["name": name, "args": values], in: nil, in: .page) { result in
                switch result {
                case .success(let value):
                    if (value as? Bool) != true {
                        NativePrompts.show("网页尚未提供这个入口，请登录并更新网页后重试。")
                    }
                case .failure:
                    NativePrompts.show("网页操作未完成，请等待页面加载后重试。")
                }
            }
        } catch { NativePrompts.show("无法准备网页操作，请重试。") }
    }

    func windowDidResize(_ notification: Notification) {
        chrome.refresh()
        tabs.layout()
    }

    func windowDidEnterFullScreen(_ notification: Notification) { chrome.refresh() }

    func windowDidExitFullScreen(_ notification: Notification) { chrome.refresh() }

    func windowDidBecomeKey(_ notification: Notification) { chrome.refresh() }

    func windowDidResignKey(_ notification: Notification) { chrome.refresh() }

    /// 告诉网页界面网页标签的变化（WebTabEvent）。页面刚载入时处理函数可能还没装上，等一会儿；不把窗口拉到前面。
    func emit(_ event: [String: Any]) {
        guard loaded else { return }
        webView.callAsyncJavaScript("""
            for (let i = 0; i < 100; i++) {
              if (typeof window.__plasticineWebTabEvent === 'function') {
                window.__plasticineWebTabEvent(event);
                return true;
              }
              await new Promise(resolve => setTimeout(resolve, 100));
            }
            return false;
            """, arguments: ["event": event], in: nil, in: .page) { _ in }
    }

    /// 告诉网页界面沉浸式翻译的事（mac-translate.ts 的 TranslateEvent）。页面刚载入时处理函数可能还没装上，等一小会儿；
    /// 网页界面还没载入就不报（脚本那边的灰条等下一次开翻时重来）。
    func emitTranslate(_ event: [String: Any]) {
        guard loaded else { return }
        webView.callAsyncJavaScript("""
            for (let i = 0; i < 40; i++) {
              if (typeof window.__plasticineTranslateEvent === 'function') {
                window.__plasticineTranslateEvent(event);
                return true;
              }
              await new Promise(resolve => setTimeout(resolve, 50));
            }
            return false;
            """, arguments: ["event": event], in: nil, in: .page) { _ in }
    }

    /// 网页菜单的 ⌘F / ⌘P / ⌘Y（web-page-tools.ts 的 WebMenuCommand）：交给网页界面；当前不是网页标签时
    /// 网页界面没装 __plasticineWebMenu，什么也不做。
    func webMenu(_ command: String) {
        guard loaded, ["find", "print", "history"].contains(command) else { return }
        webView.callAsyncJavaScript("""
            if (typeof window.__plasticineWebMenu !== 'function') return false;
            window.__plasticineWebMenu(command);
            return true;
            """, arguments: ["command": command], in: nil, in: .page) { _ in }
    }

    func navigate(hash: String) {
        show()
        guard loaded else {
            pendingHash = hash
            return
        }
        let literal = String(data: try! JSONEncoder().encode(hash), encoding: .utf8)!
        webView.evaluateJavaScript("window.location.hash = " + literal) { _, error in
            if error != nil { NativePrompts.show("无法定位通知内容，请在网页中打开对应条目。") }
        }
    }

    func external(_ url: URL) {
        guard ["https", "http", "mailto", "tel"].contains(url.scheme?.lowercased() ?? "") else {
            NativePrompts.show("这个链接无法在默认浏览器中打开。")
            return
        }
        if !NSWorkspace.shared.open(url) { NativePrompts.show("打开链接失败，请检查默认浏览器。") }
    }
}
