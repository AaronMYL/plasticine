import Foundation

// 助手请求的参数（第 14 条）：和 TypeScript 那边的 schema 一样严格——多出来的键、类型不对、超出范围一律拒
// （invalid_params），不猜、不补。时间是 ISO 8601（可带小数秒），回给壳的时间统一带毫秒的 UTC。
package struct HelperParams {
    private let fields: [String: JSONValue]

    package init(_ value: JSONValue, allowed: Set<String>) throws {
        switch value {
        case .null: fields = [:]
        case .object(let object): fields = object
        default: throw HelperError(.invalidParams, "params 要是一个对象")
        }
        let unknown = Set(fields.keys).subtracting(allowed)
        guard unknown.isEmpty else {
            throw HelperError(.invalidParams, "认不出的参数：\(unknown.sorted().joined(separator: "、"))")
        }
    }

    private func value(_ key: String) -> JSONValue? {
        guard let value = fields[key], value != .null else { return nil }
        return value
    }

    private func wrong(_ key: String, _ expected: String) -> HelperError {
        HelperError(.invalidParams, "参数 \(key) 要是\(expected)")
    }

    package func string(_ key: String, maxChars: Int = 10_000) throws -> String {
        guard let text = try optionalString(key, maxChars: maxChars) else { throw wrong(key, "非空字符串") }
        return text
    }

    package func optionalString(_ key: String, maxChars: Int = 10_000, allowEmpty: Bool = false) throws -> String? {
        guard let value = value(key) else { return nil }
        guard case .string(let text) = value, allowEmpty || !text.isEmpty, text.count <= maxChars else {
            throw wrong(key, allowEmpty ? "不超过 \(maxChars) 字的字符串" : "1–\(maxChars) 字的字符串")
        }
        return text
    }

    package func int(_ key: String, in range: ClosedRange<Int>) throws -> Int {
        guard let number = try optionalInt(key, in: range) else { throw wrong(key, "\(range) 之间的整数") }
        return number
    }

    package func optionalInt(_ key: String, in range: ClosedRange<Int>) throws -> Int? {
        guard let value = value(key) else { return nil }
        guard case .number(let number) = value, number.isFinite, number.rounded() == number,
              abs(number) <= 1e15, range.contains(Int(number)) else {
            throw wrong(key, "\(range.lowerBound)–\(range.upperBound) 之间的整数")
        }
        return Int(number)
    }

    package func bool(_ key: String, default fallback: Bool) throws -> Bool {
        guard let value = value(key) else { return fallback }
        guard case .bool(let flag) = value else { throw wrong(key, "true 或 false") }
        return flag
    }

    package func date(_ key: String) throws -> Date {
        guard let date = try optionalDate(key) else { throw wrong(key, "ISO 8601 时间") }
        return date
    }

    package func optionalDate(_ key: String) throws -> Date? {
        guard let value = value(key) else { return nil }
        guard case .string(let text) = value, let date = HelperTime.parse(text) else {
            throw wrong(key, "ISO 8601 时间（如 2026-11-08T14:00:00+08:00）")
        }
        return date
    }

    package func strings(_ key: String, maxItems: Int = 50, maxChars: Int = 1_000) throws -> [String]? {
        guard let value = value(key) else { return nil }
        guard case .array(let items) = value, items.count <= maxItems else {
            throw wrong(key, "最多 \(maxItems) 项的字符串数组")
        }
        return try items.map { item in
            guard case .string(let text) = item, !text.isEmpty, text.count <= maxChars else {
                throw wrong(key, "非空字符串的数组")
            }
            return text
        }
    }

    /// 键在不在（值是 null 也算在：update 里 null 表示清空）。
    package func has(_ key: String) -> Bool { fields[key] != nil }
}

package enum HelperTime {
    /// 收 ISO 8601：带不带小数秒、Z 或时区偏移都认。
    package static func parse(_ text: String) -> Date? {
        let precise = ISO8601DateFormatter()
        precise.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let date = precise.date(from: text) { return date }
        let plain = ISO8601DateFormatter()
        plain.formatOptions = [.withInternetDateTime]
        return plain.date(from: text)
    }

    /// 回给壳的时间：UTC、带毫秒（和服务端存的格式一样）。
    package static func format(_ date: Date) -> String {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        formatter.timeZone = TimeZone(identifier: "UTC")
        return formatter.string(from: date)
    }
}
