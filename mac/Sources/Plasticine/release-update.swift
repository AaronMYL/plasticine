import Foundation

// 带服务清单的 App 的自更新来源（docs/install-packages.md）：无论连本机还是远程实例，都读发布点的 manifest.json
// （格式见 scripts/packages/release-manifest.ts），拿 assets.mac 的 zip、核对 SHA-256 和大小，之后沿用
// SelfUpdateInstaller 的解压、重签、只换 Contents。版本比的是 App 里带的服务包版本（Resources/server/manifest.json），
// 每次发布都会变，和 Info.plist 的 0.7.x 无关。
struct ReleaseAsset: Decodable {
    let name: String
    let url: String
    let sha256: String
    let size: Int
}

struct ReleaseManifest: Decodable {
    struct Assets: Decodable {
        let mac: ReleaseAsset?
    }

    let schema: Int
    let version: String
    let commit: String
    let assets: Assets
}

enum ReleaseSource {
    static func decodeManifest(_ data: Data) throws -> ReleaseManifest {
        let manifest = try JSONDecoder().decode(ReleaseManifest.self, from: data)
        guard manifest.schema == 1, UpdateCatalog.isCommit(manifest.commit),
              manifest.version.range(of: #"^[0-9]{4}\.[0-9]{3,4}\.[0-9]{5,6}$"#,
                                     options: .regularExpression) != nil else {
            throw DeviceFailure.failed("发布清单的格式、提交来源或服务版本不对。")
        }
        try UpdateCatalog.validateVersion(manifest.version)
        if let asset = manifest.assets.mac {
            try UpdateCatalog.validateAsset(sha256: asset.sha256, size: asset.size)
        }
        return manifest
    }

    /// 发布点根地址 + manifest.json；只认 HTTPS。
    static func manifestURL(_ releaseUrl: String) throws -> URL {
        let base = releaseUrl.hasSuffix("/") ? releaseUrl : releaseUrl + "/"
        guard let root = URL(string: base), root.scheme?.lowercased() == "https",
              root.user == nil, root.password == nil,
              let manifest = URL(string: "manifest.json", relativeTo: root)?.absoluteURL else {
            throw DeviceFailure.failed("发布点地址必须是 HTTPS。")
        }
        return manifest
    }

    /// 包的下载地址：相对地址按清单位置解析；只认 HTTPS 和 64 位十六进制校验值。
    static func assetURL(_ asset: ReleaseAsset, manifest: URL) throws -> URL {
        try UpdateCatalog.validateAsset(sha256: asset.sha256, size: asset.size)
        return try UpdateCatalog.httpsURL(asset.url, relativeTo: manifest)
    }

    /// 发布点可以通过 HTTPS 重定向到文件服务器；转向仍只许去 HTTPS 地址。
    static func session() -> URLSession {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.httpCookieStorage = nil
        configuration.urlCache = nil
        configuration.timeoutIntervalForRequest = 60
        configuration.timeoutIntervalForResource = 900
        return URLSession(configuration: configuration, delegate: HTTPSOnlyRedirects(), delegateQueue: nil)
    }

    static func get(_ url: URL, session: URLSession) async throws -> Data {
        let (data, response) = try await session.data(for: URLRequest(url: url))
        guard let http = response as? HTTPURLResponse else { throw NodeHTTPError.malformed }
        guard (200..<300).contains(http.statusCode) else { throw NodeHTTPError.status(http.statusCode) }
        return data
    }
}

final class HTTPSOnlyRedirects: NSObject, URLSessionTaskDelegate {
    func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse,
                    newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) {
        completionHandler(request.url?.scheme?.lowercased() == "https" ? request : nil)
    }
}
