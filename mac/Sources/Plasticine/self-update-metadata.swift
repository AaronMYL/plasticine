import Foundation

// 自更新的元数据与版本比较（可单测）。服务端需提供最新 Mac 包：
//   GET v2/nodes/mac/latest（节点 Bearer）→ { version, sha256, url }
//   GET <url>（与服务器同源、节点 Bearer）→ 包的 zip 字节；sha256 是这些字节的 SHA-256（64 位十六进制）。
enum SelfUpdateAPI {
    static let latestPath = "v2/nodes/mac/latest"
}

/// 二进制的更新来源属于安装包；窗口连本机还是远程实例不改变它。旧安装仍认节点接口和 App 版本。
enum SelfUpdateSource: Equatable {
    case release(current: String, manifest: URL)
    case node(current: String, server: URL)

    static func resolve(bundled: BundledServerManifest?, appVersion: String, server: URL) throws -> SelfUpdateSource {
        if let bundled {
            try UpdateCatalog.validateVersion(bundled.version)
            return .release(current: bundled.version, manifest: try ReleaseSource.manifestURL(bundled.releaseUrl))
        }
        return .node(current: appVersion, server: server)
    }
}

struct UpdateMetadata: Decodable {
    let version: String
    let sha256: String
    let url: String

    /// 与公开 catalog 共用字段校验；节点凭据只交给配置服务器的同源地址。
    func downloadURL(server: URL) throws -> URL {
        try UpdateCatalog.validateVersion(version)
        try UpdateCatalog.validateAsset(sha256: sha256)
        let target = try UpdateCatalog.httpsURL(url)
        guard ServerAddress.sameOrigin(target, server) else {
            throw DeviceFailure.failed("更新包地址必须是本服务器的 HTTPS 地址。")
        }
        return target
    }
}

enum AppVersion {
    static func isValid(_ version: String) -> Bool { parts(version) != nil }

    /// 两种版本基准都按点分数字比较；非法版本不能过滤字母后假装成新版本。
    static func isNewer(_ candidate: String, than current: String) -> Bool {
        guard let left = parts(candidate), let right = parts(current) else { return false }
        for index in 0..<max(left.count, right.count) {
            let a = index < left.count ? left[index] : 0
            let b = index < right.count ? right[index] : 0
            if a != b { return a > b }
        }
        return false
    }

    private static func parts(_ version: String) -> [Int]? {
        guard version.range(of: #"^[0-9]+(\.[0-9]+){0,3}$"#, options: .regularExpression) != nil else {
            return nil
        }
        let components = version.split(separator: ".")
        let values = components.compactMap { Int($0) }
        return values.count == components.count ? values : nil
    }
}
