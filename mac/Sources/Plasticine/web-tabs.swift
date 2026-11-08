import AppKit
import WebKit

// 网页标签（第 102 条第 3 批）：每个网页标签一个独立的 WKWebView，画在网页界面量出来的中间区里；不在前的藏起来。
// 0.3.0 起垫在透明的 Plasticine 主网页下面，对话框、圆球、菜单这些浮层盖在网页上（网页界面经 sync 报 hitRegions，
// 点击怎么分见 chrome-views.swift）；没报 hitRegions 的旧网页界面照 0.2.x 叠在主网页上面。用自己的持久数据存储，
// 不跟 Plasticine 自己的页面共用 cookie：用户在这里登录的网站留在这台 Mac 上。标签清单以网页界面同步来的为准
// （web-tab-protocol.swift 的 WebTabReconcile）。

/// 网页标签那一层：只接自己子视图（网页）上的点击，别处的点击照旧交给 Plasticine 的页面。
final class WebTabHost: NSView {
    override var isFlipped: Bool { true }
    override var mouseDownCanMoveWindow: Bool { false }

    override func hitTest(_ point: NSPoint) -> NSView? {
        let hit = super.hitTest(point)
        return hit === self ? nil : hit
    }
}

@MainActor
final class WebTab {
    let id: String
    let view: WKWebView
    /// 网页界面认领过（出现在同步来的清单里）；原生层自己开、还没认领的不因清单里没有而关掉。
    var acknowledged: Bool
    let openedBy: String
    /// 正在被 Plasticine 点 / 填：这期间页面要跳去别的应用（mailto:、自定义协议）一律不跳。
    var automating = 0
    var onChange: ((WebTab) -> Void)?
    private var observers: [NSKeyValueObservation] = []
    private var waiters: [UUID: CheckedContinuation<Bool, Never>] = [:]

    init(id: String, view: WKWebView, acknowledged: Bool, openedBy: String) {
        self.id = id
        self.view = view
        self.acknowledged = acknowledged
        self.openedBy = openedBy
        let notify: (WKWebView) -> Void = { [weak self] _ in
            // WKWebView 的 KVO 在主线程上发。
            MainActor.assumeIsolated { if let self { self.onChange?(self) } }
        }
        observers = [
            view.observe(\.title) { web, _ in notify(web) },
            view.observe(\.url) { web, _ in notify(web) },
            view.observe(\.canGoBack) { web, _ in notify(web) },
            view.observe(\.canGoForward) { web, _ in notify(web) },
            view.observe(\.isLoading) { web, _ in notify(web) },
        ]
    }

    var event: [String: Any] {
        ["type": "state", "tabId": id, "url": view.url?.absoluteString ?? "", "title": view.title ?? "",
         "canGoBack": view.canGoBack, "canGoForward": view.canGoForward, "loading": view.isLoading]
    }

    /// 等这一次载入结束：载完回 true，失败、超时、标签关掉回 false。
    func waitForLoad(seconds: Double) async -> Bool {
        let key = UUID()
        return await withCheckedContinuation { continuation in
            waiters[key] = continuation
            Task { @MainActor [weak self] in
                try? await Task.sleep(nanoseconds: UInt64(seconds * 1_000_000_000))
                self?.finish(key, loaded: false)
            }
        }
    }

    func loadEnded(_ loaded: Bool) {
        for key in Array(waiters.keys) { finish(key, loaded: loaded) }
    }

    func close() {
        PageFrames.shared.forget(view)
        observers.removeAll()
        loadEnded(false)
        view.stopLoading()
        view.removeFromSuperview()
    }

    private func finish(_ key: UUID, loaded: Bool) {
        waiters.removeValue(forKey: key)?.resume(returning: loaded)
    }
}

@MainActor
final class WebTabs {
    let host = WebTabHost()
    weak var owner: WebWindow?
    private(set) var tabs: [String: WebTab] = [:]
    private var order: [String] = []
    private(set) var activeID: String?
    private var frame: WebTabFrame?
    private var regions: [WebTabFrame] = []
    private(set) var layering = WebTabLayering.overMain
    /// 在前的网页标签此刻画在哪（原生点，主窗口内容视图坐标，左上为原点）；没有在显示的就是 nil。
    private(set) var shownRect: CGRect?
    /// 盖在网页标签上的 Plasticine 浮层（原生点）。
    private(set) var hitRects: [CGRect] = []
    /// 层次换了（新旧网页界面）：主窗口把网页标签层挪到主网页下面或上面。
    var onLayeringChange: ((WebTabLayering) -> Void)?
    private lazy var delegate = WebTabDelegate(tabs: self)
    /// 沉浸式翻译（0.4.0）：所有网页标签共用它的 userContentController（注入脚本 + 独立脚本世界的消息通道）。
    let translate = WebTranslate()
    // 网页标签自己的持久数据存储（macOS 14 起可按标识分开）：固定标识，重开 App、更新后登录都还在。
    // 第 3 批：读 X 时间线（x-timeline-reader.swift）用同一个标识，所以是同一份登录。
    static let dataStoreID = UUID(uuidString: "6B1F3E2A-5C47-4D8E-9A21-3F0B7C9D4E11")!
    let dataStore = WKWebsiteDataStore(forIdentifier: WebTabs.dataStoreID)
    /// 第 3 批：登录着的网站、导入、退出（login-sites.swift），都在这份数据存储上。
    private(set) lazy var logins = LoginSites(store: dataStore)
    // 像 Safari 一样报 UA：有的网站登录页认不出裸 WKWebView 就不让登。
    static let userAgentSuffix = "Version/17.0 Safari/605.1.15"

    init() {
        translate.tabs = self
        PageFrames.shared.install(translate.controller)
    }

    func configuration() -> WKWebViewConfiguration {
        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = dataStore
        configuration.userContentController = translate.controller
        configuration.applicationNameForUserAgent = WebTabs.userAgentSuffix
        return configuration
    }

    func tab(_ id: String) -> WebTab? { tabs[id] }

    func tab(for view: WKWebView) -> WebTab? { tabs.values.first { $0.view === view } }

    var ordered: [WebTab] { order.compactMap { tabs[$0] } }

    /// 用户此刻正看着的网页标签：Plasticine 窗口在前台、是主窗口、这个标签在中间区显示着。
    var viewingID: String? {
        guard let owner, NSApp.isActive, owner.window.isKeyWindow, owner.window.isVisible,
              let id = activeID, let tab = tabs[id], !tab.view.isHidden else { return nil }
        return id
    }

    @discardableResult
    func add(id: String, url: URL?, configuration: WKWebViewConfiguration?, acknowledged: Bool,
             openedBy: String) -> WebTab {
        let view = RoutedWebView(frame: .zero, configuration: configuration ?? self.configuration())
        view.accepts = { [weak self] point in self?.owner?.route(windowPoint: point) == .tab }
        view.navigationDelegate = delegate
        view.uiDelegate = delegate
        view.allowsBackForwardNavigationGestures = true
        view.isHidden = true
        host.addSubview(view)
        let tab = WebTab(id: id, view: view, acknowledged: acknowledged, openedBy: openedBy)
        tab.onChange = { [weak self] changed in
            self?.owner?.emit(changed.event)
            self?.translate.urlChanged(changed)
        }
        tabs[id] = tab
        order.append(id)
        if let url { view.load(URLRequest(url: url)) }
        return tab
    }

    func apply(_ sync: WebTabsSync) {
        let plan = WebTabReconcile.plan(existing: tabs.mapValues { $0.acknowledged }, sync: sync)
        for id in plan.remove { remove(id) }
        for entry in plan.create {
            add(id: entry.tabId, url: WebTabURL.parse(entry.url), configuration: nil, acknowledged: true,
                openedBy: entry.openedBy ?? "user")
        }
        for entry in sync.tabs { tabs[entry.tabId]?.acknowledged = true }
        activeID = sync.active
        frame = sync.frame
        regions = sync.hitRegions ?? []
        let nextLayering = WebTabLayering.of(sync)
        if nextLayering != layering {
            layering = nextLayering
            onLayeringChange?(nextLayering)
        }
        layout()
    }

    func layout() {
        guard let owner else { return }
        let zoom = owner.zoom
        let rect = WebTabGeometry.rect(frame, zoom: zoom, bounds: host.bounds.size)
        let showing = activeID.flatMap { tabs[$0] } != nil
        shownRect = showing ? rect : nil
        hitRects = ChromeGeometry.scaled(regions, zoom: zoom)
        for (id, tab) in tabs {
            let shown = id == activeID && rect != nil
            if shown, let rect { tab.view.frame = rect }
            if !shown, let responder = owner.window.firstResponder as? NSView, responder.isDescendant(of: tab.view) {
                // 藏起来的网页不能还收着键盘输入：交回 Plasticine 的页面。
                owner.window.makeFirstResponder(owner.webView)
            }
            tab.view.isHidden = !shown
        }
    }

    func command(_ id: String, _ command: WebTabCommand) {
        guard let tab = tabs[id] else { return }
        switch command {
        case .back: tab.view.goBack()
        case .forward: tab.view.goForward()
        case .reload: tab.view.reload()
        case .stop: tab.view.stopLoading()
        case .openExternal:
            if let url = tab.view.url { owner?.external(url) }
        case .close: closedByPage(tab.view)
        }
    }

    func navigate(_ id: String, _ url: URL) {
        if owner?.openInternal(url) == true { return }
        tabs[id]?.view.load(URLRequest(url: url))
    }

    /// 「问这一页」：标题、地址、可见正文（超过上限截断并写明总字数）。
    func snapshot(_ id: String) async throws -> [String: Any] {
        guard let tab = tabs[id] else { throw DeviceFailure.failed("这个网页标签已经关了。") }
        let page = try await WebTabDOM.visibleText(tab.view)
        let clipped = PageText.clip(page.text)
        return ["tabId": id, "url": page.url, "title": page.title, "text": clipped.text, "totalChars": clipped.total,
                "truncated": clipped.truncated]
    }

    /// 原生层自己开一个标签（Plasticine 的 tab_open）：后台开，不抢用户正看着的标签。
    func open(_ url: URL) -> WebTab {
        let tab = add(id: "native:" + UUID().uuidString, url: url, configuration: nil, acknowledged: false,
                      openedBy: "plasticine")
        announce(tab, activate: false)
        return tab
    }

    /// 网页里的新窗口、target=_blank：开成新标签并切过去；WebKit 在返回的这个 WKWebView 里载入。
    func adoptWindow(configuration: WKWebViewConfiguration, url: URL?, openedBy: String = "user") -> WKWebView {
        let tab = add(id: "native:" + UUID().uuidString, url: nil, configuration: configuration, acknowledged: false,
                      openedBy: openedBy)
        announce(tab, activate: openedBy == "user", url: url)
        return tab.view
    }

    /// Plasticine 自己的页面里点到的站外链接（0.2.1 起）：开成新标签并切过去，经 webTabs 事件通道交给网页界面认领，
    /// 不再直接交给系统浏览器。
    func openForUser(_ url: URL) {
        if owner?.openInternal(url) == true { return }
        let tab = add(id: "native:" + UUID().uuidString, url: url, configuration: nil, acknowledged: false,
                      openedBy: "user")
        announce(tab, activate: true, url: url)
    }

    /// 网页界面重新载入后，把还没认领的原生标签再报一次（报的时候页面可能正好不在）。
    func reannounce() {
        for tab in ordered where !tab.acknowledged { announce(tab, activate: false) }
    }

    func closedByPage(_ view: WKWebView) {
        guard let tab = tab(for: view) else { return }
        remove(tab.id)
        owner?.emit(["type": "closed", "tabId": tab.id])
    }

    /// 键盘焦点在某个网页标签里时，⌘R 刷新它而不是 Plasticine 的页面。
    func reloadFocused() -> Bool {
        guard let responder = owner?.window.firstResponder as? NSView,
              let tab = tabs.values.first(where: { responder.isDescendant(of: $0.view) }) else { return false }
        tab.view.reload()
        return true
    }

    private func announce(_ tab: WebTab, activate: Bool, url: URL? = nil) {
        // 网页界面的标签要有地址：还没开始载入的新窗口先报请求的地址，再不行报 about:blank。
        let address = (tab.view.url ?? url)?.absoluteString ?? "about:blank"
        owner?.emit(["type": "opened", "tabId": tab.id, "url": address.isEmpty ? "about:blank" : address,
                     "title": tab.view.title ?? "", "openedBy": tab.openedBy, "activate": activate])
        owner?.emit(tab.event)
    }

    private func remove(_ id: String) {
        translate.forget(id)
        tabs.removeValue(forKey: id)?.close()
        order.removeAll { $0 == id }
        if activeID == id {
            activeID = nil
            shownRect = nil
        }
    }
}
