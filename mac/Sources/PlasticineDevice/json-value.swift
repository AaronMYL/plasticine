import Foundation

package indirect enum JSONValue: Codable, Equatable {
    case object([String: JSONValue])
    case array([JSONValue])
    case string(String)
    case number(Double)
    case bool(Bool)
    case null

    package init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        if container.decodeNil() { self = .null }
        else if let value = try? container.decode(Bool.self) { self = .bool(value) }
        else if let value = try? container.decode(String.self) { self = .string(value) }
        else if let value = try? container.decode(Double.self) { self = .number(value) }
        else if let value = try? container.decode([JSONValue].self) { self = .array(value) }
        else { self = .object(try container.decode([String: JSONValue].self)) }
    }

    package func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()
        switch self {
        case .object(let value): try container.encode(value)
        case .array(let value): try container.encode(value)
        case .string(let value): try container.encode(value)
        case .number(let value): try container.encode(value)
        case .bool(let value): try container.encode(value)
        case .null: try container.encodeNil()
        }
    }

    package static func from<T: Encodable>(_ value: T) throws -> JSONValue {
        try JSONDecoder().decode(JSONValue.self, from: JSONEncoder().encode(value))
    }
}

package enum DeviceFailure: Error, LocalizedError {
    case refused(String)
    case failed(String)
    // 点击坐标依据的截图已失效（显示器变了、App 重启过）：回 failed + errorCode screenshot_stale，服务端自动重截。
    case stale
    // 用户正看着要点 / 要填的网页标签：回 failed + errorCode user_present，服务端让任务等用户停下来。
    case present
    // 第 3 批：要点的是提交、没有放行（回 failed + errorCode submit_needs_you，带提交的种类和按钮的字）。
    case submitHeld(JSONValue)
    // 第 3 批：tab_act 的编号过期（页面变了）：回 failed + errorCode page_stale。
    case pageStale

    package var errorDescription: String? {
        switch self {
        case .refused(let message), .failed(let message): return message
        case .stale: return "点击坐标依据的截图已失效，请重新截图后再定位。"
        case .present: return "你正看着这个网页标签：这一步没有点也没有填，等你停下来再做。"
        case .submitHeld: return "这一下是提交，没有放行，没有点；先问他。"
        case .pageStale: return "页面变了（编号过期），这一步没做：先重新感知。"
        }
    }
}

package enum AppConstants {
    package static let version =
        Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "0.1.0"
    package static let fileBytes = 10 * 1024 * 1024
    package static let commandBytes = 100 * 1024
    package static let pageBytes = 200 * 1024
    package static let commandSeconds: TimeInterval = 120
    // 助手进程（第 14 条）的 command.run 可以按次给更长的超时，但不超过 10 分钟：再长的活该开后台线分段做。
    package static let commandSecondsMax: TimeInterval = 600
    package static let heartbeatSeconds: UInt64 = 60
}
