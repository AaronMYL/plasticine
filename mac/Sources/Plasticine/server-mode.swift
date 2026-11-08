import Foundation

// 安装包（docs/install-packages.md）：Mac App 可以自己带一份 Plasticine 服务跑在本机（「这台 Mac」），
// 也可以像以前一样连远程服务器（「远程地址」，连自己的服务器）。设置里切换。
enum ServerMode: String {
    case thisMac
    case remote

    /// 第一次启动时选哪种：包里没带服务只能远程；以前装过（有设置或 App 的数据目录）保持远程，不改老用户的行为。
    static func initial(hasBundledServer: Bool, hasPriorInstall: Bool) -> ServerMode {
        guard hasBundledServer else { return .remote }
        return hasPriorInstall ? .remote : .thisMac
    }

    var title: String {
        switch self {
        case .thisMac: return "这台 Mac"
        case .remote: return "远程地址"
        }
    }
}

enum LocalServerAddress {
    /// 和服务的默认端口一致（agent/src/app/config.ts DEFAULT_PORT），Linux / Windows 安装包也用这个。
    static let port = 8790
    // 固定字面量，编译期即正确。
    static let url = URL(string: "http://127.0.0.1:\(port)/")!
}

/// App 里带的服务：Contents/MacOS/node 加 Contents/Resources/server（build.sh --server 放进去的服务包）。
struct BundledServerManifest: Decodable {
    let version: String
    let releaseUrl: String
}

enum BundledServer {
    static var directory: URL? {
        Bundle.main.resourceURL?.appendingPathComponent("server", isDirectory: true)
    }

    static var node: URL? { Bundle.main.url(forAuxiliaryExecutable: "node") }

    static var available: Bool { manifest() != nil && node != nil }

    static func manifest() -> BundledServerManifest? {
        guard let directory, let data = try? Data(contentsOf: directory.appendingPathComponent("manifest.json")) else {
            return nil
        }
        return try? JSONDecoder().decode(BundledServerManifest.self, from: data)
    }
}
