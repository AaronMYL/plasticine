import Foundation
import WebKit

@MainActor
final class PageFrames: NSObject, WKScriptMessageHandler {
    static let shared = PageFrames()
    private static let channel = "plasticineFrameDocument"
    private static let maximumFrames = 60
    private let controllers = NSHashTable<WKUserContentController>.weakObjects()
    private let pages = NSMapTable<WKWebView, FramePage>.weakToStrongObjects()

    private static let beacon = """
        (() => {
          // randomUUID 只在安全上下文可用；getRandomValues 也支持普通 HTTP 页面。
          const bytes = crypto.getRandomValues(new Uint8Array(16));
          bytes[6] = (bytes[6] & 15) | 64;
          bytes[8] = (bytes[8] & 63) | 128;
          const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
          const id = [hex.slice(0, 8), hex.slice(8, 12), hex.slice(12, 16),
            hex.slice(16, 20), hex.slice(20)].join('-');
          Object.defineProperty(window, '__plasticineFrameDocument', { value: id });
          const report = (event) => window.webkit.messageHandlers.plasticineFrameDocument.postMessage({ id, event });
          report('ready');
          addEventListener('pagehide', () => report('gone'));
          addEventListener('pageshow', () => report('ready'));
          for (const type of ['pointerdown', 'keydown']) {
            addEventListener(type, (event) => { if (event.isTrusted) report('takeover'); }, true);
          }
        })();
        """

    func install(_ controller: WKUserContentController) {
        guard !controllers.contains(controller) else { return }
        controllers.add(controller)
        controller.add(self, contentWorld: .defaultClient, name: Self.channel)
        controller.addUserScript(WKUserScript(source: Self.beacon, injectionTime: .atDocumentStart,
                                              forMainFrameOnly: false, in: .defaultClient))
    }

    func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
        guard message.name == Self.channel, let view = message.webView,
              let body = message.body as? [String: String], let id = body["id"], UUID(uuidString: id) != nil else {
            return
        }
        let page = state(view)
        switch body["event"] {
        case "gone":
            page.frames.removeAll { $0.id == id }
        case "takeover":
            page.signature = ""
            page.version = UUID().uuidString
        case "ready":
            guard !page.frames.contains(where: { $0.id == id }) else { return }
            if message.frameInfo.isMainFrame { page.frames.removeAll() }
            page.frames.append(FrameDocument(id: id, info: message.frameInfo))
        default:
            return
        }
    }

    private func state(_ view: WKWebView) -> FramePage {
        if let page = pages.object(forKey: view) { return page }
        let page = FramePage()
        pages.setObject(page, forKey: view)
        return page
    }

    func forget(_ view: WKWebView) { pages.removeObject(forKey: view) }

    private func authorize(_ frame: FrameDocument, sites: [String]) throws {
        let origin = frame.info.securityOrigin
        guard ["http", "https"].contains(origin.protocol), !origin.host.isEmpty,
              LimitPolicy.siteAllowed(origin.host, sites: sites) else {
            throw DeviceFailure.refused("内嵌页面不在已授权的网页范围内，没有读取或操作。")
        }
    }

    private func evaluate(_ view: WKWebView, _ frame: FrameDocument, _ request: [String: Any]) async throws
        -> [String: JSONValue] {
        let script = """
            if (window.__plasticineFrameDocument !== documentID) {
              return JSON.stringify({ ok: false, error: 'frame_stale' });
            }
            \(PageOperateScript.source)
            """
        let value: Any = try await withCheckedThrowingContinuation { continuation in
            view.callAsyncJavaScript(script, arguments: ["request": request, "documentID": frame.id],
                                     in: frame.info, in: .defaultClient) { continuation.resume(with: $0) }
        }
        guard let text = value as? String, let data = text.data(using: .utf8),
              case .object(let result) = try JSONDecoder().decode(JSONValue.self, from: data),
              result["error"] != .string("frame_stale") else { throw DeviceFailure.pageStale }
        return result
    }

    private func collect(_ view: WKWebView, sites: [String]) async throws -> [FrameReading] {
        let page = state(view)
        guard page.frames.contains(where: { $0.info.isMainFrame }) else {
            throw DeviceFailure.failed("页面的框架读取尚未就绪；请等载入完成后重新感知。")
        }
        guard page.frames.count <= Self.maximumFrames else {
            throw DeviceFailure.failed("页面内嵌框架过多，未生成可操作编号。")
        }
        var readings: [FrameReading] = []
        for frame in page.frames {
            try authorize(frame, sites: sites)
            let result: [String: JSONValue]
            do {
                result = try await evaluate(view, frame, ["op": "perceive"])
            } catch let error as DeviceFailure {
                throw error
            } catch {
                throw DeviceFailure.failed("内嵌页面已失效或 WebKit 无法读取；未取得完整内容，请重新感知。")
            }
            readings.append(FrameReading(frame: frame, page: result))
        }
        guard readings.map({ $0.frame.id }) == page.frames.map({ $0.id }) else { throw DeviceFailure.pageStale }
        let expected = readings.reduce(1) { count, reading in
            guard case .number(let children) = reading.page["frameCount"] else { return count }
            return count + Int(children)
        }
        guard expected == readings.count else {
            throw DeviceFailure.failed("内嵌页面尚未登记，可能仍在载入或受网页限制；未取得完整内容，请稍后重新读取。")
        }
        return readings
    }

    func text(_ view: WKWebView, _ request: [String: Any], sites: [String] = []) async throws -> String {
        let readings: [FrameReading]
        do {
            readings = try await collect(view, sites: sites)
        } catch {
            // 这里只捕获动作前的只读检查；实际动作报错必须保留结果不明，不伪称没执行。
            if request["op"] as? String == "act", !(error is DeviceFailure) {
                return try encode(["ok": .bool(false), "error": .string("stale")])
            }
            if case DeviceFailure.pageStale = error, request["op"] as? String == "act" {
                return try encode(["ok": .bool(false), "error": .string("stale")])
            }
            throw error
        }
        let page = state(view)
        let perception = try page.merge(readings)
        var result: [String: JSONValue]
        if request["op"] as? String == "perceive" {
            result = perception
        } else if request["op"] as? String == "act" {
            guard request["version"] as? String == page.version,
                  var act = request["act"] as? [String: Any] else {
                return try encode(["ok": .bool(false), "error": .string("stale")])
            }
            let globalNumber = act["n"] as? Int
            let route: FrameRoute
            if act["op"] as? String == "scroll", let main = readings.first(where: { $0.frame.info.isMainFrame }) {
                route = FrameRoute(frame: main.frame, version: main.version, localNumber: 0)
            } else if let n = globalNumber, let found = page.routes[n] {
                route = found
                act["n"] = route.localNumber
            } else {
                return try encode(["ok": .bool(false), "error": .string("stale")])
            }
            result = try await evaluate(view, route.frame, ["op": "act", "version": route.version,
                "act": act, "allowSubmit": request["allowSubmit"] as? Bool == true])
            if let n = globalNumber, case .object(var target) = result["target"] {
                target["n"] = .number(Double(n))
                result["target"] = .object(target)
            }
        } else {
            throw DeviceFailure.refused("不支持的网页框架操作")
        }
        return try encode(result)
    }

    private func encode(_ object: [String: JSONValue]) throws -> String {
        String(decoding: try JSONEncoder().encode(JSONValue.object(object)), as: UTF8.self)
    }

    func readPage(_ view: WKWebView, offset: Int, sites: [String] = []) async throws -> JSONValue {
        let readings = try await collect(view, sites: sites)
        var parts: [String] = []
        for reading in readings {
            let result = try await evaluate(view, reading.frame, ["op": "read", "offset": 0])
            guard case .string(let text) = result["text"] else { throw DeviceFailure.pageStale }
            parts.append("〔页面：\(reading.url)〕\n" + text)
        }
        let all = Array(parts.joined(separator: "\n\n"))
        let start = min(max(0, offset), all.count)
        let end = min(start + WebTabDOM.readTextChars, all.count)
        guard case .object(var result) = try await WebTabDOM.readPage(view, offset: offset) else {
            throw DeviceFailure.pageStale
        }
        result["text"] = .string(String(all[start..<end]))
        result["offset"] = .number(Double(start))
        result["totalChars"] = .number(Double(all.count))
        result["nextOffset"] = end < all.count ? .number(Double(end)) : .null
        if readings.count > 1 {
            result["fieldsTruncated"] = .bool(true)
            result["linksTruncated"] = .bool(true)
        }
        return .object(result)
    }
}

private struct FrameDocument {
    let id: String
    let info: WKFrameInfo
}

private struct FrameReading {
    let frame: FrameDocument
    let page: [String: JSONValue]
    var version: String {
        if case .string(let value) = page["version"] { return value }
        return ""
    }
    var url: String {
        if case .string(let value) = page["url"] { return value }
        return ""
    }
}

private struct FrameRoute {
    let frame: FrameDocument
    let version: String
    let localNumber: Int
}

private final class FramePage {
    var frames: [FrameDocument] = []
    var signature = ""
    var version = ""
    var routes: [Int: FrameRoute] = [:]

    func merge(_ readings: [FrameReading]) throws -> [String: JSONValue] {
        guard var merged = readings.first(where: { $0.frame.info.isMainFrame })?.page else {
            throw DeviceFailure.pageStale
        }
        let next = readings.map { $0.frame.id + ":" + $0.version }.joined(separator: "|")
        if signature != next {
            version = UUID().uuidString
            signature = next
        }
        routes = [:]
        var elements: [JSONValue] = []
        var outlines: [String] = []
        var truncated = false
        for reading in readings {
            guard case .array(let items) = reading.page["elements"],
                  case .string(var outline) = reading.page["outline"] else { throw DeviceFailure.pageStale }
            let offset = elements.count
            for item in items {
                guard elements.count < 200 else { truncated = true; break }
                guard case .object(var fields) = item, case .number(let local) = fields["n"] else { continue }
                let n = elements.count + 1
                fields["n"] = .number(Double(n))
                routes[n] = FrameRoute(frame: reading.frame, version: reading.version, localNumber: Int(local))
                elements.append(.object(fields))
            }
            for index in (1...max(1, items.count)).reversed() {
                let number = offset + index
                let label = number <= 200 ? "[\(number) " : "[未编号 "
                outline = outline.replacingOccurrences(of: "[\(index) ", with: label)
            }
            outlines.append("〔页面：\(reading.url)〕\n" + outline)
            if reading.page["truncated"] == .bool(true) { truncated = true }
        }
        let text = outlines.joined(separator: "\n\n")
        merged["outline"] = .string(String(text.prefix(12_000)))
        merged["totalChars"] = .number(Double(text.count))
        merged["truncated"] = .bool(truncated || text.count > 12_000)
        merged["elements"] = .array(elements)
        merged["version"] = .string(version)
        merged["digest"] = .string(version)
        return merged
    }
}
