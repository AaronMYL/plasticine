import Foundation

// Mirrors agent/shared/api/devices.ts and state-devices.ts. Transport follows the long-poll v1 contract.
enum ActionKind: String, Codable, CaseIterable {
    case fileList = "file_list", fileRead = "file_read", fileWrite = "file_write", fileDelete = "file_delete"
    case runCommand = "run_command", browserOpen = "browser_open", browserRead = "browser_read"
    case screenCapture = "screen_capture", inputClick = "input_click", inputType = "input_type", appOpen = "app_open"
    // 第 102 条第 3 批：Plasticine 窗口里的网页标签（用户登录着的 WKWebView），按 DOM 读、开、走、点、填。
    case tabList = "tab_list", tabRead = "tab_read", tabOpen = "tab_open", tabNavigate = "tab_navigate"
    case tabClick = "tab_click", tabFill = "tab_fill"
    // 第 3 批「问这一页 → 操作整页」：感知整页（结构 + 带编号的元素）、按编号点 / 填 / 选 / 回车 / 翻页（提交前问他）。
    case tabPerceive = "tab_perceive", tabAct = "tab_act"

    var actionClass: String {
        switch self {
        case .fileList, .fileRead: return "read"
        case .fileWrite: return "write"
        case .fileDelete: return "delete"
        case .runCommand: return "command"
        case .browserOpen, .browserRead, .tabList, .tabRead, .tabOpen, .tabNavigate, .tabPerceive: return "browser"
        case .screenCapture, .inputClick, .inputType, .appOpen, .tabClick, .tabFill, .tabAct: return "input"
        }
    }

    var isTab: Bool {
        switch self {
        case .tabList, .tabRead, .tabOpen, .tabNavigate, .tabClick, .tabFill, .tabPerceive, .tabAct: return true
        default: return false
        }
    }
}

/// tab_act 的那一下（和 agent/shared/api/page-operate.ts 的 PageActSchema 一致）：按编号点、填、选、回车，或翻页。
struct PageActParams: Codable, Equatable {
    let op: String
    let n: Int?
    let value: String?
    let dy: Int?

    static let ops: Set<String> = ["click", "fill", "select", "enter", "scroll"]
    static let maxElements = 200
    static let maxScroll = 10_000
    static let maxFill = 4_000

    func validate() throws {
        guard PageActParams.ops.contains(op) else { throw DeviceFailure.refused("不认识的网页操作") }
        if op == "scroll" {
            guard let dy, abs(dy) <= PageActParams.maxScroll, n == nil, value == nil else {
                throw DeviceFailure.refused("翻页要给滚多少像素")
            }
            return
        }
        guard let n, n >= 1, n <= PageActParams.maxElements, dy == nil else {
            throw DeviceFailure.refused("网页操作要给元素编号")
        }
        let needsValue = op == "fill" || op == "select"
        guard needsValue == (value != nil), (value?.unicodeScalars.count ?? 0) <= PageActParams.maxFill else {
            throw DeviceFailure.refused("填和选要给值，点和回车不给")
        }
    }

    /// 交给注入脚本的形状。
    var script: [String: Any] {
        var fields: [String: Any] = ["op": op]
        if let n { fields["n"] = n }
        if let value { fields["value"] = value }
        if let dy { fields["dy"] = dy }
        return fields
    }
}

struct ActionParams: Decodable {
    let kind: ActionKind
    let path: String?
    let content: String?
    let baseVersion: String?
    let cwd: String?
    let command: String?
    let url: String?
    let x: Int?
    let y: Int?
    let text: String?
    let app: String?
    let tabId: String?
    let offset: Int?
    let selector: String?
    let value: String?
    // 第 3 批 tab_act：感知时的编号版本、那一下、对话框里的一句、放行提交的那张卡（平时 null）。
    let version: String?
    let act: PageActParams?
    let step: String?
    let submitAsk: String?
    private let hasBaseVersion: Bool
    private let suppliedFields: Set<String>

    private struct WireKey: CodingKey {
        let stringValue: String
        var intValue: Int? { nil }
        init?(stringValue: String) { self.stringValue = stringValue }
        init?(intValue: Int) { return nil }
    }

    private enum CodingKeys: String, CodingKey, CaseIterable {
        case kind, path, content, baseVersion, cwd, command, url, x, y, text, app, tabId, offset, selector, value
        case version, act, step, submitAsk
    }

    init(from decoder: Decoder) throws {
        let fields = try decoder.container(keyedBy: CodingKeys.self)
        suppliedFields = Set(try decoder.container(keyedBy: WireKey.self).allKeys.map(\.stringValue))
        kind = try fields.decode(ActionKind.self, forKey: .kind)
        path = try fields.decodeIfPresent(String.self, forKey: .path)
        content = try fields.decodeIfPresent(String.self, forKey: .content)
        baseVersion = try fields.decodeIfPresent(String.self, forKey: .baseVersion)
        hasBaseVersion = fields.contains(.baseVersion)
        cwd = try fields.decodeIfPresent(String.self, forKey: .cwd)
        command = try fields.decodeIfPresent(String.self, forKey: .command)
        url = try fields.decodeIfPresent(String.self, forKey: .url)
        x = try fields.decodeIfPresent(Int.self, forKey: .x)
        y = try fields.decodeIfPresent(Int.self, forKey: .y)
        text = try fields.decodeIfPresent(String.self, forKey: .text)
        app = try fields.decodeIfPresent(String.self, forKey: .app)
        tabId = try fields.decodeIfPresent(String.self, forKey: .tabId)
        offset = try fields.decodeIfPresent(Int.self, forKey: .offset)
        selector = try fields.decodeIfPresent(String.self, forKey: .selector)
        value = try fields.decodeIfPresent(String.self, forKey: .value)
        version = try fields.decodeIfPresent(String.self, forKey: .version)
        act = try fields.decodeIfPresent(PageActParams.self, forKey: .act)
        step = try fields.decodeIfPresent(String.self, forKey: .step)
        submitAsk = try fields.decodeIfPresent(String.self, forKey: .submitAsk)
    }

    func validate() throws {
        let expected: Set<String>
        switch kind {
        case .fileList, .fileRead, .fileDelete: expected = ["kind", "path"]
        case .fileWrite: expected = ["kind", "path", "content", "baseVersion"]
        case .runCommand: expected = ["kind", "cwd", "command"]
        case .browserOpen, .browserRead: expected = ["kind", "url"]
        case .screenCapture: expected = ["kind"]
        case .inputClick: expected = ["kind", "x", "y"]
        case .inputType: expected = ["kind", "text"]
        case .appOpen: expected = ["kind", "app"]
        case .tabList: expected = ["kind"]
        case .tabRead: expected = ["kind", "tabId", "offset"]
        case .tabOpen: expected = ["kind", "url"]
        case .tabNavigate: expected = ["kind", "tabId", "url"]
        case .tabClick: expected = ["kind", "tabId", "selector", "text"]
        case .tabFill: expected = ["kind", "tabId", "selector", "value"]
        case .tabPerceive: expected = ["kind", "tabId"]
        case .tabAct: expected = ["kind", "tabId", "version", "act", "step", "submitAsk"]
        }
        guard suppliedFields == expected else { throw DeviceFailure.refused("动作参数有缺项或多余字段") }
        func required(_ value: String?, max: Int, empty: Bool = false) throws {
            guard let value, (empty || !value.isEmpty), value.unicodeScalars.count <= max else {
                throw DeviceFailure.refused("动作参数不完整或超出范围")
            }
        }
        func validateUrl() throws {
            try required(url, max: 2_048)
            guard let parsed = URL(string: url!), ["http", "https"].contains(parsed.scheme?.lowercased() ?? ""),
                  parsed.host != nil else { throw DeviceFailure.refused("网页地址必须使用 HTTP 或 HTTPS") }
        }
        switch kind {
        case .fileList, .fileRead, .fileDelete: try required(path, max: 1_000)
        case .fileWrite:
            try required(path, max: 1_000)
            try required(content, max: 400_000, empty: true)
            guard hasBaseVersion, baseVersion != "" else {
                throw DeviceFailure.refused("写入必须提供 baseVersion，新文件使用 null")
            }
        case .runCommand:
            try required(cwd, max: 1_000)
            try required(command, max: 4_000)
            guard !command!.contains("\0") else { throw DeviceFailure.refused("命令不能包含空字符") }
        case .browserOpen, .browserRead, .tabOpen:
            try validateUrl()
        case .tabNavigate:
            try required(tabId, max: WebTabMessage.maxIdLength)
            try validateUrl()
        case .tabList: break
        case .tabRead:
            try required(tabId, max: WebTabMessage.maxIdLength)
            guard let offset, offset >= 0 else { throw DeviceFailure.refused("读标签要给从第几个字读起") }
        case .tabClick:
            try required(tabId, max: WebTabMessage.maxIdLength)
            // 选择器和按钮上的字恰好给一项（和服务端 limits.ts 一致）。
            guard (selector == nil) != (text == nil) else { throw DeviceFailure.refused("点网页标签要给选择器或字，恰好一项") }
            if selector != nil { try required(selector, max: 500) } else { try required(text, max: 200) }
        case .tabFill:
            try required(tabId, max: WebTabMessage.maxIdLength)
            try required(selector, max: 500)
            try required(value, max: 4_000, empty: true)
        case .tabPerceive:
            try required(tabId, max: WebTabMessage.maxIdLength)
        case .tabAct:
            try required(tabId, max: WebTabMessage.maxIdLength)
            try required(version, max: 40)
            try required(step, max: 60)
            guard let act else { throw DeviceFailure.refused("网页操作缺这一下做什么") }
            try act.validate()
            if submitAsk != nil, act.op != "click", act.op != "enter" {
                throw DeviceFailure.refused("放行提交只给点和回车")
            }
        case .inputClick:
            guard let x, let y, x >= 0, y >= 0 else { throw DeviceFailure.refused("点击坐标不完整") }
        case .inputType: try required(text, max: 4_000)
        case .appOpen: try required(app, max: 200)
        case .screenCapture: break
        }
    }
}

struct RemoteAction: Codable {
    let id: String
    let kind: String
    let params: JSONValue
    let deadline: String

    var expiry: Date? {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let date = formatter.date(from: deadline) { return date }
        formatter.formatOptions = [.withInternetDateTime]
        return formatter.date(from: deadline)
    }

    func validatedParams() throws -> ActionParams {
        // The server sends kind beside params, not inside (agent/src/devices/transport.ts); put it back to decode.
        // A kind inside params is still accepted, and must match the outer one.
        guard case .object(var fields) = params else { throw DeviceFailure.refused("动作参数必须是对象") }
        if fields["kind"] == nil { fields["kind"] = .string(kind) }
        let decoded = try JSONDecoder().decode(ActionParams.self, from: JSONEncoder().encode(JSONValue.object(fields)))
        guard decoded.kind.rawValue == kind else { throw DeviceFailure.refused("动作种类和参数不一致") }
        try decoded.validate()
        return decoded
    }
}

struct NextAction: Decodable { let action: RemoteAction }

struct ActionReport: Codable, Equatable {
    let status: String
    var result: JSONValue?
    var error: String?
    // 第 102 条「设备失败先分类」：screenshot_stale 让服务端自动重截后再重新定位，不当一般失败。
    var errorCode: String?
    var refusalLayer: String?

    static func executed(_ result: JSONValue) -> ActionReport {
        ActionReport(status: "executed", result: result)
    }

    static func refused(_ message: String) -> ActionReport {
        ActionReport(status: "refused", error: message, refusalLayer: "device")
    }

    static func failed(_ message: String) -> ActionReport {
        ActionReport(status: "failed", error: message)
    }

    static func present() -> ActionReport {
        ActionReport(status: "failed", error: "你正看着这个网页标签：这一步没有点也没有填，等你停下来再做。",
                     errorCode: "user_present")
    }

    static func stale() -> ActionReport {
        ActionReport(status: "failed", error: "点击坐标依据的截图已失效，请重新截图后再定位。", errorCode: "screenshot_stale")
    }

    /// 第 3 批：要点的是提交、没有放行，没点；result 里带提交的种类、按钮的字和元素（page-operate.ts 的 PageSubmitHold）。
    static func submitHeld(_ result: JSONValue) -> ActionReport {
        ActionReport(status: "failed", result: result, error: "这一下是提交，没有放行，没有点；先问他。",
                     errorCode: "submit_needs_you")
    }

    /// 第 3 批：编号过期（页面变了），没做。
    static func pageStale() -> ActionReport {
        ActionReport(status: "failed", error: "页面变了（编号过期），这一步没做：先重新感知。", errorCode: "page_stale")
    }
}

struct ClassLimit: Codable {
    let mode: String
    let perHour: Int
}

struct DeviceLimits: Codable {
    let roots: [String]
    let apps: [String]
    let sites: [String]
    let unattendedInput: Bool
    // 第 102 条：缺省（nil）或 "deny" 都是关死；只有签名放开成 "confirm_each" 付款类才降为「要你点」。
    // hello 上限里的其它未知键（Codable 只解已声明的键）不影响解码。
    let payments: String?
    let classes: [String: ClassLimit]
}

struct PairRequest: Encodable {
    let requestId: String
    let code: String
    let name: String
    let platform = "macos"
    let appVersion = AppConstants.version
    let protocolVersion = 1
    let capabilities: [ActionKind]
}

struct PairResponse: Decodable {
    let nodeId: String
    let credential: String
    let limits: DeviceLimits
    let limitsVersion: Int
}

struct HelloRequest: Encodable {
    let appVersion = AppConstants.version
    let protocolVersion = 1
    let capabilities: [ActionKind]
    // 可选：用户最近一次键鼠活动距今多少秒；用户在用时服务端让点击 / 输入等着（第 102 条）。每次 hello 都报。
    let idleSeconds: Int?
}

struct HelloResponse: Decodable {
    let nodeId: String
    let limits: DeviceLimits
    let limitsVersion: Int
}
