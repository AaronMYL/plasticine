import CoreGraphics
import Foundation

// 网页标签的桥接协议（第 102 条第 3 批），和 agent/shared/api/mac-bridge.ts 对照。这里只放不碰 WebKit 的纯逻辑：
// 解析网页发来的消息、算原生网页该画在哪、正文截断、标签清单的增删，方便 XCTest。

struct WebTabFrame: Decodable, Equatable {
    let x: Double
    let y: Double
    let width: Double
    let height: Double
}

struct WebTabEntry: Decodable, Equatable {
    let tabId: String
    let url: String
    var openedBy: String? = nil
}

struct WebTabsSync: Decodable, Equatable {
    let tabs: [WebTabEntry]
    let active: String?
    let frame: WebTabFrame?
    /// 0.3.0 起：盖在网页标签上的 Plasticine 浮层（对话框、圆球、菜单、弹层），CSS 像素、相对主网页视口；落在这些
    /// 矩形里的鼠标事件给主网页，网页标签区其余给网页标签。旧网页界面不带这个字段（见 WebTabLayering）。
    var hitRegions: [WebTabFrame]? = nil
}

enum WebTabCommand: String, Decodable {
    case back, forward, reload, stop, close
    case openExternal = "open_external"
}

enum WebTabProtocolError: Error, Equatable {
    case malformed(String)
}

enum WebTabMessage: Equatable {
    case sync(WebTabsSync)
    case command(String, WebTabCommand)
    case navigate(String, URL)
    case snapshot(String)
    /// 第 2 批「浏览器」：网页工具（web-page-tool-protocol.swift）。
    case tool(String, WebPageTool)

    // 和 mac-bridge.ts 的 WEB_TABS_MAX、标签标识长度一致。
    static let maxTabs = 50
    static let maxIdLength = 100
    // 和 mac-bridge.ts WebTabsSyncSchema 的 hitRegions maxItems 一致。
    static let maxHitRegions = 200

    private struct Envelope: Decodable {
        let type: String
        let state: WebTabsSync?
        let tabId: String?
        let command: WebTabCommand?
        let url: String?
        let tool: WebPageToolEnvelope?
    }

    /// 网页经 `plasticineTabs` 发来的一条消息；形状不对一律拒，不猜。
    static func parse(_ body: Any) throws -> WebTabMessage {
        guard JSONSerialization.isValidJSONObject(body) else { throw WebTabProtocolError.malformed("不是对象") }
        let envelope: Envelope
        do {
            envelope = try JSONDecoder().decode(Envelope.self, from: JSONSerialization.data(withJSONObject: body))
        } catch { throw WebTabProtocolError.malformed("字段不对") }
        switch envelope.type {
        case "sync":
            guard let state = envelope.state, state.tabs.count <= maxTabs,
                  state.tabs.allSatisfy({ validId($0.tabId) && ($0.openedBy == nil
                    || ["user", "plasticine"].contains($0.openedBy!)) }), state.active.map(validId) ?? true else {
                throw WebTabProtocolError.malformed("标签清单不对")
            }
            let regions = state.hitRegions ?? []
            guard regions.count <= maxHitRegions, regions.allSatisfy(ChromeGeometry.wellFormed) else {
                throw WebTabProtocolError.malformed("浮层矩形不对")
            }
            return .sync(state)
        case "command":
            guard let id = envelope.tabId, validId(id), let command = envelope.command else {
                throw WebTabProtocolError.malformed("命令不对")
            }
            return .command(id, command)
        case "navigate":
            guard let id = envelope.tabId, validId(id), let url = WebTabURL.parse(envelope.url) else {
                throw WebTabProtocolError.malformed("网址只收 http 和 https")
            }
            return .navigate(id, url)
        case "snapshot":
            guard let id = envelope.tabId, validId(id) else { throw WebTabProtocolError.malformed("标签不对") }
            return .snapshot(id)
        case "tool":
            guard let id = envelope.tabId, validId(id) else { throw WebTabProtocolError.malformed("标签不对") }
            return .tool(id, try WebPageTool.parse(envelope.tool))
        default:
            throw WebTabProtocolError.malformed("不认识的消息")
        }
    }

    static func validId(_ id: String) -> Bool { !id.isEmpty && id.count <= maxIdLength }
}

enum WebTabURL {
    /// 只收带主机的 http(s) 地址：网页标签不开 file:、javascript: 这些。
    static func parse(_ text: String?) -> URL? {
        guard let text, text.count <= 4_096, let url = URL(string: text),
              ["http", "https"].contains(url.scheme?.lowercased() ?? ""), url.host?.isEmpty == false else { return nil }
        return url
    }
}

enum WebTabGeometry {
    /// 网页给的 CSS 像素矩形换成原生坐标（左上为原点，乘页面缩放），裁到主网页的范围里；太小或不合法就不显示。
    static func rect(_ frame: WebTabFrame?, zoom: CGFloat, bounds: CGSize) -> CGRect? {
        guard let frame, [frame.x, frame.y, frame.width, frame.height].allSatisfy(\.isFinite),
              frame.width > 0, frame.height > 0, zoom > 0 else { return nil }
        let scaled = CGRect(
            x: frame.x * zoom, y: frame.y * zoom, width: frame.width * zoom, height: frame.height * zoom
        )
        let clipped = scaled.intersection(CGRect(origin: .zero, size: bounds))
        return clipped.isNull || clipped.width < 1 || clipped.height < 1 ? nil : clipped
    }
}

enum PageText {
    // 「问这一页」的正文上限，和 mac-bridge.ts 的 WEB_PAGE_TEXT_MAX_CHARS 一致（按 Unicode 字符数）。
    static let maxChars = 100_000

    static func clip(_ text: String, max: Int = maxChars) -> (text: String, total: Int, truncated: Bool) {
        let scalars = text.unicodeScalars
        let total = scalars.count
        guard total > max else { return (text, total, false) }
        var kept = String.UnicodeScalarView()
        kept.append(contentsOf: scalars.prefix(max))
        return (String(kept), total, true)
    }
}

struct WebTabPlan: Equatable {
    let create: [WebTabEntry]
    let remove: [String]
}

enum WebTabReconcile {
    /// 网页同步来的清单 → 要新开哪些、要关哪些。原生层自己开、网页还没认领过的标签（acknowledged 为 false）不关：
    /// 「新标签」事件和这份清单可能交错到达。
    static func plan(existing: [String: Bool], sync: WebTabsSync) -> WebTabPlan {
        var seen = Set<String>()
        var create: [WebTabEntry] = []
        for entry in sync.tabs where !seen.contains(entry.tabId) {
            seen.insert(entry.tabId)
            if existing[entry.tabId] == nil { create.append(entry) }
        }
        let remove = existing.filter { !seen.contains($0.key) && $0.value }.map(\.key).sorted()
        return WebTabPlan(create: create, remove: remove)
    }
}

enum WebTabPresence {
    // 和服务端 USER_ACTIVE_IDLE_SECONDS 一致：最近 30 秒内动过键鼠算「正在用」。
    static let activeIdleSeconds = 30

    /// 用户正看着这个标签（窗口在前、它在中间区）并且刚动过键鼠：点和填先让路（第 102 条「用户在场让路」）。
    static func blocks(viewing: Bool, idleSeconds: Int) -> Bool { viewing && idleSeconds < activeIdleSeconds }
}
