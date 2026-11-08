import AppKit
import WebKit

// 沉浸式翻译（Mac 0.4.0，第 2 批，协议见 agent/shared/api/mac-translate.ts）。网页标签共用一个 userContentController：
// 每个主 frame 文档载入完就在独立脚本世界（PlasticineTranslate）里装上 TranslatePageScript（client/src/mac/translate-page*.ts
// 生成），页面自己的脚本碰不到它，也碰不到它的消息通道。原生层只转话、不调模型：
//   网页界面 configure / deliver → 这里记下每个标签想要的状态，调脚本的 start / stop / apply；
//   脚本 page / request / progress / ask → 补上 tabId 转给网页界面（window.__plasticineTranslateEvent）；copy 由这里放进剪贴板。
// 页面换了文档（脚本重新报 page），想要开着的标签自动接着开；付款类页面（三条道关死的那类）和有卡号框的页面不开。

@MainActor
final class WebTranslate: NSObject {
    static let world = WKContentWorld.world(name: "PlasticineTranslate")
    let controller = WKUserContentController()
    weak var tabs: WebTabs?
    /// 每个标签想要的状态：nil 或没有 = 关着。
    private var desired: [String: TranslatePageConfig] = [:]
    /// 这一份文档的脚本报过页面上有卡号框。
    private var cardFields: [String: Bool] = [:]
    /// 上一次报给网页界面的地址（地址变了才再报一次 page）。
    private var reported: [String: String] = [:]
    private lazy var pageHandler = WebTranslatePageHandler(owner: self)

    override init() {
        super.init()
        let script = WKUserScript(source: TranslatePageScript.source, injectionTime: .atDocumentEnd,
                                  forMainFrameOnly: true, in: WebTranslate.world)
        controller.addUserScript(script)
        controller.add(pageHandler, contentWorld: WebTranslate.world, name: "plasticineTranslatePage")
    }

    func configure(_ tabId: String, _ config: TranslatePageConfig?) {
        desired[tabId] = config
        guard let tab = tabs?.tab(tabId) else { return }
        guard let config else {
            run(tab, "if (window.__plasticineTranslator) window.__plasticineTranslator.stop(); return true;", [:])
            return
        }
        start(tab, config)
    }

    func deliver(_ tabId: String, _ delivery: TranslateDelivery) {
        guard let tab = tabs?.tab(tabId), desired[tabId]?.run == delivery.run else { return }
        run(tab, "if (window.__plasticineTranslator) window.__plasticineTranslator.apply(delivery); return true;",
            ["delivery": delivery.json])
    }

    /// 网页标签的地址变了（换文档或单页应用自己改了地址）：重新报这一页能不能翻。
    func urlChanged(_ tab: WebTab) {
        let url = tab.view.url?.absoluteString ?? ""
        guard !url.isEmpty, reported[tab.id] != url else { return }
        reported[tab.id] = url
        let blocked = TranslateGate.blocked(url: url, cardFields: cardFields[tab.id] ?? false)
        tabs?.owner?.emitTranslate(["type": "page", "tabId": tab.id, "url": url, "blocked": blocked])
    }

    func forget(_ tabId: String) {
        desired.removeValue(forKey: tabId)
        cardFields.removeValue(forKey: tabId)
        reported.removeValue(forKey: tabId)
    }

    /// 脚本经独立脚本世界的通道发来一条消息。
    func received(_ message: TranslatePageMessage, from view: WKWebView) {
        guard let tab = tabs?.tab(for: view) else { return }
        switch message {
        case .page(let url, let cards):
            // 新文档：页面上有没有卡号框按这一份算；想要开着的标签接着开。
            cardFields[tab.id] = cards
            reported[tab.id] = url
            let blocked = TranslateGate.blocked(url: url, cardFields: cards)
            tabs?.owner?.emitTranslate(["type": "page", "tabId": tab.id, "url": url, "blocked": blocked])
            if let config = desired[tab.id], !blocked { start(tab, config) }
        case .copy(let text):
            NSPasteboard.general.clearContents()
            NSPasteboard.general.setString(text, forType: .string)
        case .request(let run, _, _, _, _), .progress(let run, _, _, _, _, _):
            // 关掉以后还在路上的消息不转：网页界面已经不等这一轮了。
            guard desired[tab.id]?.run == run, let event = message.event(tabId: tab.id) else { return }
            tabs?.owner?.emitTranslate(event)
        case .ask:
            if let event = message.event(tabId: tab.id) { tabs?.owner?.emitTranslate(event) }
        }
    }

    private func start(_ tab: WebTab, _ config: TranslatePageConfig) {
        let url = tab.view.url?.absoluteString ?? ""
        if TranslateGate.blocked(url: url, cardFields: cardFields[tab.id] ?? false) {
            tabs?.owner?.emitTranslate(["type": "page", "tabId": tab.id, "url": url, "blocked": true])
            return
        }
        // 脚本还没装上（文档还在载入）时回 null：等它报 page 再开。
        run(tab, "return window.__plasticineTranslator ? window.__plasticineTranslator.start(config) : null;",
            ["config": config.json])
    }

    private func run(_ tab: WebTab, _ body: String, _ arguments: [String: Any]) {
        tab.view.callAsyncJavaScript(body, arguments: arguments, in: nil, in: WebTranslate.world) { result in
            if case .failure(let error) = result {
                // 页面正在换文档时会失败；新文档的脚本会报 page，到时候按想要的状态再开。
                NSLog("Plasticine：网页翻译没能告诉网页标签：%@", error.localizedDescription)
            }
        }
    }
}

/// 网页标签独立脚本世界里的消息通道：页面自己的脚本拿不到这个通道。
@MainActor
final class WebTranslatePageHandler: NSObject, WKScriptMessageHandler {
    private weak var owner: WebTranslate?

    init(owner: WebTranslate) { self.owner = owner }

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard message.frameInfo.isMainFrame, let view = message.webView else { return }
        do {
            owner?.received(try TranslatePageMessage.parse(message.body), from: view)
        } catch {
            NSLog("Plasticine：网页翻译脚本的消息不对：%@", String(describing: error))
        }
    }
}

/// Plasticine 主网页的 `plasticineTranslate` 通道（window.plasticineMac.translate）：只收本站主 frame 的消息，不要回执。
@MainActor
final class WebTranslateBridge: NSObject, WKScriptMessageHandler {
    weak var owner: WebWindow?

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard let owner, message.webView === owner.webView, message.frameInfo.isMainFrame,
              let url = message.frameInfo.request.url, ServerAddress.sameOrigin(url, owner.settings.server) else {
            return
        }
        do {
            switch try TranslateCommand.parse(message.body) {
            case .configure(let tabId, let config): owner.tabs.translate.configure(tabId, config)
            case .deliver(let tabId, let delivery): owner.tabs.translate.deliver(tabId, delivery)
            }
        } catch {
            NSLog("Plasticine：网页翻译命令不对：%@", String(describing: error))
        }
    }
}
