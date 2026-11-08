import AppKit
import WebKit

// 第 3 批信息流（用户 11-04 定）：用他在 Plasticine 浏览器里的 X 登录，Mac 在线时定时读「关注」时间线——不花钱、频率低。
// 协议见 agent/shared/api/feed-x.ts：每 10 分钟问服务端一次到没到（GET /v2/nodes/feed/x，节点 Bearer；来源关着、
// 没到两小时都回 due = false）；到了就在一个看不见的网页视图里载入 x.com/home（和网页标签同一个网站数据存储，所以是同一份
// 登录），在独立脚本世界里装上 XTimelineScript（client/src/mac/x-timeline-page.ts 生成），切到「关注」、往下翻几屏、
// 收帖子，交给服务端（POST 同一地址）。没登录 / X 改版认不出 / 页面没打开，只交原因，设置里那一行写出来，不弹窗。
// 这台 Mac 没配对、设备服务暂停时不读。读完就把网页视图拆掉，不留在内存里。

@MainActor
final class XTimelineReader: NSObject, WKNavigationDelegate {
    /// 多久问一次服务端到没到（真正读的频率由服务端定：每 2 小时）。
    private static let askEverySeconds: TimeInterval = 10 * 60
    /// App 启动后先等一会儿再问第一次，别和启动时的同步、自更新挤在一起。
    private static let firstAskDelaySeconds: TimeInterval = 90
    private static let homeURL = URL(string: "https://x.com/home")!
    private static let path = "v2/nodes/feed/x"
    private static let world = WKContentWorld.world(name: "PlasticineXTimeline")
    /// 页面载入最多等这么久；X 的时间线出来再等这么久。
    private static let loadTimeoutSeconds: Double = 30
    private static let timelineTimeoutSeconds = 20
    /// 切到「关注」以后等它换内容；每翻一屏等新帖子载入。
    private static let switchWaitSeconds: Double = 4
    private static let scrollWaitSeconds: Double = 2.5
    private static let scrolls = 4

    private let settings: AppSettings

    // WebKit 的 WebCrypto 主密钥交我们自己的，不让 WebKit 去钥匙串里取（见 web-crypto-master-key.swift）。
    @objc(_webCryptoMasterKeyForWebView:)
    func webCryptoMasterKey(forWebView webView: WKWebView) -> Data? { WebCryptoMasterKey.data() }

    @objc(_webCryptoMasterKeyForWebView:completionHandler:)
    func webCryptoMasterKey(forWebView webView: WKWebView, completionHandler: @escaping (Data?) -> Void) {
        completionHandler(WebCryptoMasterKey.data())
    }

    private var timer: Timer?
    private var running = false
    private var window: NSWindow?
    private var loadWaiter: CheckedContinuation<String?, Never>?
    /// 这一次载入的标识：超时那个定时任务只收它自己那一次，不误收后来的。
    private var loadToken = UUID()
    /// 最近一次没读成的原因（菜单、日志看）；读成了清掉。
    private(set) var lastFailure: String?

    init(settings: AppSettings) {
        self.settings = settings
    }

    func start() {
        timer?.invalidate()
        timer = Timer.scheduledTimer(withTimeInterval: Self.askEverySeconds, repeats: true) { [weak self] _ in
            Task { @MainActor in await self?.tick() }
        }
        Task { @MainActor [weak self] in
            try? await Task.sleep(nanoseconds: UInt64(Self.firstAskDelaySeconds * 1_000_000_000))
            await self?.tick()
        }
    }

    func stop() {
        timer?.invalidate()
        timer = nil
        tearDown()
    }

    func tick() async {
        guard !running, !settings.paused else { return }
        let server = settings.server
        guard settings.nodeID(for: server) != nil else { return }
        let credential: String
        do {
            guard let stored = try NodeCredentialStore.read(server: server) else { return }
            credential = stored
        } catch {
            note("读不到这台 Mac 的节点凭证：\(error.localizedDescription)")
            return
        }
        running = true
        defer { running = false }
        let session = Self.session()
        defer { session.invalidateAndCancel() }
        do {
            let due = try await ask(server: server, credential: credential, session: session)
            guard due else { return }
            let body = await read()
            try await send(body, server: server, credential: credential, session: session)
            lastFailure = nil
        } catch {
            note("X 时间线这次没交上：\(error.localizedDescription)")
        }
    }

    // MARK: 和服务端

    private static func session() -> URLSession {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.httpCookieStorage = nil
        configuration.urlCache = nil
        configuration.timeoutIntervalForRequest = 40
        return URLSession(configuration: configuration, delegate: NoRedirects(), delegateQueue: nil)
    }

    private func ask(server: URL, credential: String, session: URLSession) async throws -> Bool {
        var request = URLRequest(url: server.appendingPathComponent(Self.path))
        request.setValue("Bearer " + credential, forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        let data = try await Self.check(session.data(for: request))
        guard let object = try JSONSerialization.jsonObject(with: data) as? [String: Any],
              let due = object["due"] as? Bool else { throw NodeHTTPError.malformed }
        return due
    }

    private func send(_ body: [String: Any], server: URL, credential: String, session: URLSession) async throws {
        var request = URLRequest(url: server.appendingPathComponent(Self.path))
        request.httpMethod = "POST"
        request.setValue("Bearer " + credential, forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.httpBody = try JSONSerialization.data(withJSONObject: body)
        _ = try await Self.check(session.data(for: request))
    }

    private static func check(_ result: (Data, URLResponse)) throws -> Data {
        guard let http = result.1 as? HTTPURLResponse else { throw NodeHTTPError.malformed }
        if http.statusCode == 401 { throw NodeHTTPError.unauthorized }
        guard (200..<300).contains(http.statusCode) else { throw NodeHTTPError.status(http.statusCode) }
        return result.0
    }

    // MARK: 读

    /// 读一遍，回要交给服务端的请求体：{ requestId, posts, error }（error 没有时是 null，服务端要这个键）。
    private func read() async -> [String: Any] {
        let requestId = "x-" + UUID().uuidString.lowercased()
        defer { tearDown() }
        let view = makeView()
        if let failure = await load(view) {
            return Self.failed(requestId, "load_failed", failure)
        }
        var state = "loading"
        for _ in 0..<Self.timelineTimeoutSeconds {
            state = (try? await call(view, "return window.__plasticineXTimeline.state();") as? String) ?? "loading"
            if state != "loading" { break }
            await pause(1)
        }
        if state == "signed_out" { return Self.failed(requestId, "signed_out", nil) }
        if state != "ready" { return Self.failed(requestId, "layout_changed", "页面里没出现时间线") }
        do {
            let switched = try await call(view, "return window.__plasticineXTimeline.following();")
            if switched is NSNull || switched == nil {
                return Self.failed(requestId, "layout_changed", "找不到「关注」那一栏")
            }
            if (switched as? Bool) == true { await pause(Self.switchWaitSeconds) }
            for _ in 0..<Self.scrolls {
                _ = try await call(view, "return window.__plasticineXTimeline.collect();")
                _ = try await call(view, "window.__plasticineXTimeline.scroll(); return true;")
                await pause(Self.scrollWaitSeconds)
            }
            _ = try await call(view, "return window.__plasticineXTimeline.collect();")
            let posts = try await call(view, "return window.__plasticineXTimeline.posts();") as? [Any] ?? []
            if posts.isEmpty { return Self.failed(requestId, "layout_changed", "没认出帖子") }
            return ["requestId": requestId, "posts": posts, "error": NSNull()]
        } catch {
            return Self.failed(requestId, "layout_changed", error.localizedDescription)
        }
    }

    private static func failed(_ requestId: String, _ code: String, _ detail: String?) -> [String: Any] {
        var error: [String: Any] = ["code": code]
        if let detail { error["detail"] = String(detail.prefix(300)) }
        return ["requestId": requestId, "posts": [Any](), "error": error]
    }

    private func call(_ view: WKWebView, _ body: String) async throws -> Any? {
        try await view.callAsyncJavaScript(body, arguments: [:], in: nil, contentWorld: Self.world)
    }

    private func pause(_ seconds: Double) async {
        try? await Task.sleep(nanoseconds: UInt64(seconds * 1_000_000_000))
    }

    /// 看不见的网页视图：放在一个透明、不接鼠标、不进窗口列表的窗口里（不在窗口里时 X 的无限滚动不往下载）。
    private func makeView() -> WKWebView {
        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = WKWebsiteDataStore(forIdentifier: WebTabs.dataStoreID)
        configuration.applicationNameForUserAgent = WebTabs.userAgentSuffix
        let script = WKUserScript(source: XTimelineScript.source, injectionTime: .atDocumentEnd,
                                  forMainFrameOnly: true, in: Self.world)
        configuration.userContentController.addUserScript(script)
        let frame = NSRect(x: -20_000, y: -20_000, width: 1_100, height: 1_600)
        let view = WKWebView(frame: NSRect(origin: .zero, size: frame.size), configuration: configuration)
        view.navigationDelegate = self
        let window = NSWindow(contentRect: frame, styleMask: [.borderless], backing: .buffered, defer: false)
        window.isReleasedWhenClosed = false
        window.alphaValue = 0
        window.ignoresMouseEvents = true
        window.isExcludedFromWindowsMenu = true
        window.collectionBehavior = [.transient, .ignoresCycle, .stationary]
        window.contentView = view
        window.orderBack(nil)
        self.window = window
        return view
    }

    private func tearDown() {
        finishLoad(with: "读取已停止")
        if let view = window?.contentView as? WKWebView {
            view.stopLoading()
            view.navigationDelegate = nil
        }
        window?.orderOut(nil)
        window?.contentView = nil
        window = nil
    }

    /// 载入 x.com/home：载完回 nil，没载完回原因（超时、断网）。
    private func load(_ view: WKWebView) async -> String? {
        let token = UUID()
        loadToken = token
        view.load(URLRequest(url: Self.homeURL))
        return await withCheckedContinuation { continuation in
            loadWaiter = continuation
            Task { @MainActor [weak self] in
                try? await Task.sleep(nanoseconds: UInt64(Self.loadTimeoutSeconds * 1_000_000_000))
                guard let self, self.loadToken == token else { return }
                self.finishLoad(with: "等了 \(Int(Self.loadTimeoutSeconds)) 秒没载完")
            }
        }
    }

    private func finishLoad(with failure: String?) {
        let waiter = loadWaiter
        loadWaiter = nil
        waiter?.resume(returning: failure)
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        finishLoad(with: nil)
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        finishLoad(with: error.localizedDescription)
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        finishLoad(with: error.localizedDescription)
    }

    private func note(_ message: String) {
        lastFailure = message
        NSLog("Plasticine：%@", message)
    }
}
