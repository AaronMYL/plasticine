import Foundation

// 网页工具（2026-11-04 第 2 批「浏览器」），和 agent/shared/api/web-page-tools.ts 对照：网页界面经 `plasticineTabs`
// 发 { type: 'tool', tabId, tool: { kind, … } }，要回执。这里只放不碰 WebKit 的纯逻辑（解析、上限、长图缩放），
// 方便 XCTest；做法在 web-page-tools.swift。
// 注意：这台机器没有 Xcode，这份第 2 批写的时候没能编译，等 GitHub macOS 机器上跑 swift build / swift test。

struct WebPageToolEnvelope: Decodable, Equatable {
    let kind: String
    let query: String?
    let backwards: Bool?
    let factor: Double?
    let scope: String?
    let points: [WebExtractMark]?
    let focus: Int?
    let color: String?
}

struct WebExtractMark: Codable, Equatable {
    let quote: String
    let context: String
}

enum WebPageTool: Equatable {
    case find(query: String, backwards: Bool)
    case findClear
    case zoom(Double)
    case capture(fullPage: Bool)
    case print
    case circle
    case circleCancel
    case thumbnail
    case downloads
    // 第 3 批「问这一页 → 感知整页」：页面结构 + 带编号的元素（page-operate.swift）。
    case perceive
    case extractImages
    case extractMarks(points: [WebExtractMark], focus: Int?, color: String?)

    /// 这台 Mac 会做的几样，报给网页界面（注入脚本的 webTabs.tools）；和 WEB_PAGE_TOOLS 的名字一致。
    static let supported = ["find", "zoom", "capture", "capture_full", "print", "circle", "thumbnail", "downloads",
                            "perceive", "extract_images", "extract_marks"]
    // 和 web-page-tools.ts 的 WEB_FIND_MAX_CHARS、WEB_ZOOM_MIN / MAX、WEB_THUMBNAIL_WIDTH、WEB_IMAGE_MAX_BYTES、
    // WEB_CIRCLE_TEXT_MAX_CHARS 一致。
    static let maxFindChars = 500
    static let zoomRange = 0.5...3.0
    static let thumbnailWidth = 560.0
    static let imageMaxBytes = 10 * 1024 * 1024
    static let circleMaxChars = 20_000
    /// 整页截图最长边的像素：再长的页面按比例缩小，免得一张图几十 MB。
    static let fullPageMaxPixels = 16_384.0

    static func parse(_ envelope: WebPageToolEnvelope?) throws -> WebPageTool {
        guard let envelope else { throw WebTabProtocolError.malformed("缺工具") }
        switch envelope.kind {
        case "find":
            guard let query = envelope.query, !query.isEmpty, query.count <= maxFindChars else {
                throw WebTabProtocolError.malformed("查找的字不对")
            }
            return .find(query: query, backwards: envelope.backwards ?? false)
        case "find_clear": return .findClear
        case "zoom":
            guard let factor = envelope.factor, factor.isFinite, zoomRange.contains(factor) else {
                throw WebTabProtocolError.malformed("缩放不对")
            }
            return .zoom(factor)
        case "capture":
            guard let scope = envelope.scope, ["visible", "full"].contains(scope) else {
                throw WebTabProtocolError.malformed("截图范围不对")
            }
            return .capture(fullPage: scope == "full")
        case "print": return .print
        case "circle": return .circle
        case "circle_cancel": return .circleCancel
        case "thumbnail": return .thumbnail
        case "downloads": return .downloads
        case "perceive": return .perceive
        case "extract_images": return .extractImages
        case "extract_marks":
            guard let points = envelope.points, points.count <= 12,
                  points.allSatisfy({ !$0.quote.isEmpty && $0.quote.count <= 1000 && $0.context.count <= 60_000 }),
                  envelope.focus.map({ (0...11).contains($0) }) ?? true,
                  (envelope.color?.count ?? 0) <= 150 else {
                throw WebTabProtocolError.malformed("网页重点格式不对")
            }
            return .extractMarks(points: points, focus: envelope.focus, color: envelope.color)
        default: throw WebTabProtocolError.malformed("不认识的工具")
        }
    }

    /// 整页长图画多大：长边超过上限就按比例缩小。
    static func fullPageSize(width: Double, height: Double) -> CGSize {
        guard width > 0, height > 0 else { return .zero }
        let scale = min(1, fullPageMaxPixels / max(width, height))
        return CGSize(width: (width * scale).rounded(), height: (height * scale).rounded())
    }

    /// 圈一块回来的字截到上限（按 Unicode 字符数）。
    static func clipCircleText(_ text: String) -> String {
        let scalars = text.unicodeScalars
        guard scalars.count > circleMaxChars else { return text }
        var kept = String.UnicodeScalarView()
        kept.append(contentsOf: scalars.prefix(circleMaxChars))
        return String(kept)
    }
}
