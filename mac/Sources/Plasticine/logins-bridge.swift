import Foundation
import WebKit

// 登录的消息通道 `plasticineLogins`（2026-11-04 第 3 批，协议见 agent/shared/api/mac-logins.ts）：网页界面的设置 · 浏览器
// 列登录着的网站、从 Chrome / Safari 导入、退出一个网站、打开「完全磁盘访问」。和 plasticineTabs 一样只收 Plasticine
// 主网页本站主 frame 的消息；网页标签里的页面用另一套配置，根本没有这个通道。回给网页的只有网站名、个数和结果。
// 第 6 条（2026-11-05）：只导登录状态，导入消息里的 passwords 是旧网页带的，收下不用（没带也认）。
// 注意：这台机器没有 Xcode，这份第 3 批写的时候没能编译，等 GitHub macOS 机器上跑 swift build / swift test 和真 App。

enum LoginsMessage: Equatable {
    case sites
    case sources
    case importFrom(source: String)
    case forget(host: String)
    case fullDiskAccess

    static let importSources = ["chrome", "safari"]
    static let maxHostLength = 253

    static func parse(_ body: Any) throws -> LoginsMessage {
        guard let fields = body as? [String: Any], let type = fields["type"] as? String else {
            throw WebTabProtocolError.malformed("登录消息不是对象")
        }
        switch type {
        case "sites": return .sites
        case "sources": return .sources
        case "import":
            guard let source = fields["from"] as? String, importSources.contains(source) else {
                throw WebTabProtocolError.malformed("导入要说从哪儿")
            }
            return .importFrom(source: source)
        case "forget":
            guard let host = fields["host"] as? String, !host.isEmpty, host.count <= maxHostLength else {
                throw WebTabProtocolError.malformed("退出要给网站")
            }
            return .forget(host: host)
        case "full_disk_access": return .fullDiskAccess
        default: throw WebTabProtocolError.malformed("不认识的登录消息")
        }
    }
}

@MainActor
final class LoginsBridge: NSObject, WKScriptMessageHandlerWithReply {
    weak var owner: WebWindow?

    func userContentController(
        _ userContentController: WKUserContentController, didReceive message: WKScriptMessage,
        replyHandler: @escaping (Any?, String?) -> Void
    ) {
        guard let owner, message.webView === owner.webView, message.frameInfo.isMainFrame,
              let url = message.frameInfo.request.url, ServerAddress.sameOrigin(url, owner.settings.server) else {
            replyHandler(nil, "只接受 Plasticine 主页面的消息")
            return
        }
        let parsed: LoginsMessage
        do { parsed = try LoginsMessage.parse(message.body) } catch {
            replyHandler(nil, "登录消息格式不对")
            return
        }
        let sites = owner.tabs.logins
        switch parsed {
        case .sites:
            Task { replyHandler(["sites": await sites.list()], nil) }
        case .sources:
            replyHandler(["sources": LoginImporter.sources()], nil)
        case .importFrom(let source):
            Task { replyHandler(await LoginImporter.run(from: source, sites: sites), nil) }
        case .forget(let host):
            Task {
                await sites.forget(host)
                replyHandler(true, nil)
            }
        case .fullDiskAccess:
            LoginImporter.openFullDiskAccess()
            replyHandler(true, nil)
        }
    }
}
