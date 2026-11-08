import Foundation

// 沉浸式翻译的桥接协议（Mac 0.4.0，第 2 批），和 agent/shared/api/mac-translate.ts 对照。这里只放不碰 WebKit 的纯逻辑：
// 解析网页界面发来的命令（开 / 关 / 送译文）、网页标签里注入的脚本发来的消息（这一页能不能翻、要译的段落、进度、
// 问这一段、复制），以及付款类页面的判法，方便 XCTest。设备不调模型：段落经这里转给网页界面，译文经这里送回脚本。

struct TranslatePageConfig: Codable, Equatable {
    let run: String
    let target: String
    let display: String

    var json: [String: Any] { ["run": run, "target": target, "display": display] }
}

struct TranslateSegment: Codable, Equatable {
    let id: String
    let text: String

    var json: [String: Any] { ["id": id, "text": text] }
}

struct TranslateDelivery: Codable, Equatable {
    let run: String
    let items: [TranslateSegment]
    let failed: [String]

    var json: [String: Any] { ["run": run, "items": items.map(\.json), "failed": failed] }
}

enum TranslateProtocolError: Error, Equatable {
    case malformed(String)
}

enum TranslateLimits {
    // 和 mac-translate.ts / translate.ts 一致。
    static let targets: Set<String> = ["zh-CN", "zh-TW", "en", "ja", "ko", "fr", "de", "es"]
    static let displays: Set<String> = ["bilingual", "translation"]
    static let deliveryMax = 48
    static let itemChars = 4_000
    static let askChars = 8_000
    /** 复制的是译文：可能比原文长一些，给原文上限的两倍。 */
    static let copyChars = 16_000

    static func validRun(_ run: String) -> Bool {
        (1...64).contains(run.count) && run.unicodeScalars.allSatisfy { scalar in
            CharacterSet.alphanumerics.contains(scalar) && scalar.isASCII || scalar == "_" || scalar == "-"
        }
    }

    static func validSegmentId(_ id: String) -> Bool {
        (1...64).contains(id.count) && id.unicodeScalars.allSatisfy { scalar in
            CharacterSet.alphanumerics.contains(scalar) && scalar.isASCII || ["_", ":", ".", "-"].contains(scalar)
        }
    }

    static func validConfig(_ config: TranslatePageConfig) -> Bool {
        validRun(config.run) && targets.contains(config.target) && displays.contains(config.display)
    }

    static func chars(_ text: String) -> Int { text.unicodeScalars.count }
}

/// 网页界面经 `plasticineTranslate` 发来的命令（window.plasticineMac.translate）。
enum TranslateCommand: Equatable {
    case configure(String, TranslatePageConfig?)
    case deliver(String, TranslateDelivery)

    private struct Envelope: Decodable {
        let type: String
        let tabId: String?
        let config: TranslatePageConfig?
        let delivery: TranslateDelivery?
    }

    static func parse(_ body: Any) throws -> TranslateCommand {
        let envelope: Envelope = try decode(body)
        guard let tabId = envelope.tabId, WebTabMessage.validId(tabId) else {
            throw TranslateProtocolError.malformed("标签不对")
        }
        switch envelope.type {
        case "configure":
            if let config = envelope.config, !TranslateLimits.validConfig(config) {
                throw TranslateProtocolError.malformed("翻译设置不对")
            }
            return .configure(tabId, envelope.config)
        case "deliver":
            guard let delivery = envelope.delivery, TranslateLimits.validRun(delivery.run),
                  delivery.items.count <= TranslateLimits.deliveryMax,
                  delivery.failed.count <= TranslateLimits.deliveryMax,
                  delivery.items.allSatisfy({ TranslateLimits.validSegmentId($0.id) }),
                  delivery.failed.allSatisfy(TranslateLimits.validSegmentId) else {
                throw TranslateProtocolError.malformed("译文不对")
            }
            return .deliver(tabId, delivery)
        default:
            throw TranslateProtocolError.malformed("不认识的消息")
        }
    }
}

/// 网页标签里注入的脚本经 `plasticineTranslatePage`（独立脚本世界）发来的消息。
enum TranslatePageMessage: Equatable {
    case page(url: String, blocked: Bool)
    case request(run: String, url: String, priority: String, fresh: Bool, items: [TranslateSegment])
    case progress(run: String, pending: Int, done: Int, failed: Int, chars: Int, firstScreenMs: Int?)
    case ask(url: String, title: String, source: String, translation: String)
    case copy(String)

    private struct Envelope: Decodable {
        let type: String
        let url: String?
        let blocked: Bool?
        let run: String?
        let priority: String?
        let fresh: Bool?
        let items: [TranslateSegment]?
        let pending: Int?
        let done: Int?
        let failed: Int?
        let chars: Int?
        let firstScreenMs: Int?
        let title: String?
        let source: String?
        let translation: String?
        let text: String?
    }

    static func parse(_ body: Any) throws -> TranslatePageMessage {
        let envelope: Envelope = try decode(body)
        switch envelope.type {
        case "page":
            guard let url = envelope.url, let blocked = envelope.blocked else {
                throw TranslateProtocolError.malformed("页面消息不对")
            }
            return .page(url: url, blocked: blocked)
        case "request":
            guard let run = envelope.run, TranslateLimits.validRun(run), let url = envelope.url,
                  let priority = envelope.priority, ["visible", "ahead"].contains(priority),
                  let items = envelope.items, (1...TranslateLimits.deliveryMax).contains(items.count),
                  items.allSatisfy({ TranslateLimits.validSegmentId($0.id) && !$0.text.isEmpty
                      && TranslateLimits.chars($0.text) <= TranslateLimits.itemChars }) else {
                throw TranslateProtocolError.malformed("要译的段落不对")
            }
            return .request(run: run, url: url, priority: priority, fresh: envelope.fresh ?? false, items: items)
        case "progress":
            guard let run = envelope.run, TranslateLimits.validRun(run), let pending = envelope.pending,
                  let done = envelope.done, let failed = envelope.failed, let chars = envelope.chars,
                  [pending, done, failed, chars].allSatisfy({ $0 >= 0 }),
                  (envelope.firstScreenMs ?? 0) >= 0 else {
                throw TranslateProtocolError.malformed("进度不对")
            }
            return .progress(run: run, pending: pending, done: done, failed: failed, chars: chars,
                             firstScreenMs: envelope.firstScreenMs)
        case "ask":
            guard let url = envelope.url, let source = envelope.source, let translation = envelope.translation,
                  TranslateLimits.chars(source) <= TranslateLimits.askChars,
                  TranslateLimits.chars(translation) <= TranslateLimits.askChars else {
                throw TranslateProtocolError.malformed("问这一段不对")
            }
            return .ask(url: url, title: envelope.title ?? "", source: source, translation: translation)
        case "copy":
            guard let text = envelope.text, TranslateLimits.chars(text) <= TranslateLimits.copyChars else {
                throw TranslateProtocolError.malformed("复制的字不对")
            }
            return .copy(text)
        default:
            throw TranslateProtocolError.malformed("不认识的消息")
        }
    }

    /// 转给网页界面的事件（补上 tabId）；复制由原生自己做，不转。
    func event(tabId: String) -> [String: Any]? {
        switch self {
        case .page(let url, let blocked):
            return ["type": "page", "tabId": tabId, "url": url, "blocked": blocked]
        case .request(let run, let url, let priority, let fresh, let items):
            return ["type": "request", "tabId": tabId, "run": run, "url": url, "priority": priority, "fresh": fresh,
                    "items": items.map(\.json)]
        case .progress(let run, let pending, let done, let failed, let chars, let firstScreenMs):
            return ["type": "progress", "tabId": tabId, "run": run, "pending": pending, "done": done,
                    "failed": failed, "chars": chars, "firstScreenMs": firstScreenMs.map { $0 as Any } ?? NSNull()]
        case .ask(let url, let title, let source, let translation):
            return ["type": "ask", "tabId": tabId, "url": url, "title": title, "source": source,
                    "translation": translation]
        case .copy:
            return nil
        }
    }
}

enum TranslateGate {
    /// 这一页能不能翻：付款类页面（设备三条道关死的那类，按网址判）和页面上有卡号框的都不翻。判不准从严。
    static func blocked(url: String, cardFields: Bool) -> Bool {
        cardFields || DeviceLanePolicy.isPaymentPage(url)
    }
}

private func decode<T: Decodable>(_ body: Any) throws -> T {
    guard JSONSerialization.isValidJSONObject(body) else { throw TranslateProtocolError.malformed("不是对象") }
    do {
        return try JSONDecoder().decode(T.self, from: JSONSerialization.data(withJSONObject: body))
    } catch { throw TranslateProtocolError.malformed("字段不对") }
}
