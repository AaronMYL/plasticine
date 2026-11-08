import Foundation

// 两种更新来源保留各自的版本基准，但版本、文件校验值和地址按同一规则接收。
enum UpdateCatalog {
    private static let sha256Length = 64
    private static let commitLength = 40

    static func validateVersion(_ version: String) throws {
        guard AppVersion.isValid(version) else {
            throw DeviceFailure.failed("更新元数据的版本号不是点分数字。")
        }
    }

    static func validateAsset(sha256: String, size: Int? = nil) throws {
        guard isHex(sha256, length: sha256Length), size.map({ $0 > 0 }) ?? true else {
            throw DeviceFailure.failed("更新包的校验值或大小不对。")
        }
    }

    static func isCommit(_ value: String) -> Bool {
        isHex(value, length: commitLength)
    }

    static func httpsURL(_ value: String, relativeTo base: URL? = nil) throws -> URL {
        guard let url = URL(string: value, relativeTo: base)?.absoluteURL,
              url.scheme?.lowercased() == "https", url.host?.isEmpty == false,
              url.user == nil, url.password == nil else {
            throw DeviceFailure.failed("更新包地址必须是没有内嵌凭据的 HTTPS 地址。")
        }
        return url
    }

    private static func isHex(_ value: String, length: Int) -> Bool {
        value.count == length && value.allSatisfy { "0123456789abcdef".contains($0) }
    }
}
