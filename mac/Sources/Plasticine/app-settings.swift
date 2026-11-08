import Foundation
import CryptoKit

enum ServerAddress {
    static func parse(_ text: String) throws -> URL {
        guard var parts = URLComponents(string: text.trimmingCharacters(in: .whitespacesAndNewlines)),
              parts.scheme?.lowercased() == "https", let host = parts.host, !host.isEmpty,
              parts.user == nil, parts.password == nil, parts.query == nil, parts.fragment == nil,
              parts.path.isEmpty || parts.path == "/" else {
            throw DeviceFailure.failed("服务器地址应为 https://主机名或IP[:端口]/，请检查后保存。")
        }
        parts.scheme = "https"
        parts.host = host.lowercased()
        parts.path = "/"
        guard let url = parts.url else { throw DeviceFailure.failed("服务器地址无效，请检查后保存。") }
        return url
    }

    static func sameOrigin(_ lhs: URL, _ rhs: URL) -> Bool {
        lhs.scheme?.lowercased() == rhs.scheme?.lowercased()
            && lhs.host?.lowercased() == rhs.host?.lowercased()
            && effectivePort(lhs) == effectivePort(rhs)
    }

    /// 「这台 Mac」模式下服务在 http://127.0.0.1（只听本机，不出这台电脑）；节点配对认它，也认任何 HTTPS 服务器。
    /// 别的明文 http 地址不配对：配对凭证会经过网络。
    static func pairable(_ url: URL) -> Bool {
        switch url.scheme?.lowercased() {
        case "https": return url.host?.isEmpty == false
        case "http": return ["127.0.0.1", "localhost", "::1"].contains(url.host?.lowercased() ?? "")
        default: return false
        }
    }

    private static func effectivePort(_ url: URL) -> Int {
        url.port ?? (url.scheme?.lowercased() == "http" ? 80 : 443)
    }
}

final class AppSettings {
    private let defaults = UserDefaults.standard

    init() {
        // 第一次启动就把模式定下来存好：之后别的部件会写设置、建数据目录，那时再判断「以前装过没有」就不准了。
        if defaults.string(forKey: "serverMode") == nil {
            let initial = ServerMode.initial(hasBundledServer: BundledServer.available,
                                             hasPriorInstall: Self.hasPriorInstall(defaults))
            defaults.set(initial.rawValue, forKey: "serverMode")
        }
    }

    /// 「这台 Mac」还是「远程地址」；包里没带服务时只能是远程。
    var mode: ServerMode {
        get {
            let saved = ServerMode(rawValue: defaults.string(forKey: "serverMode") ?? "") ?? .remote
            return saved == .thisMac && !BundledServer.available ? .remote : saved
        }
        set { defaults.set(newValue.rawValue, forKey: "serverMode") }
    }

    /// 远程模式连的服务器（只接受 HTTPS）。
    var remoteServer: URL {
        get {
            let raw = defaults.string(forKey: "server") ?? "https://you.cyberhunter.top/"
            return (try? ServerAddress.parse(raw)) ?? URL(string: "https://you.cyberhunter.top/")!
        }
        set { defaults.set(newValue.absoluteString, forKey: "server") }
    }

    /// 窗口、网页桥、设备服务实际连的地址：「这台 Mac」是 App 自己起的本机服务。
    var server: URL { mode == .thisMac ? LocalServerAddress.url : remoteServer }

    /// 以前跑过 Plasticine：这个 App 的设置域里已经有东西，或者数据目录已经在了。
    static func hasPriorInstall(_ defaults: UserDefaults) -> Bool {
        let domain = Bundle.main.bundleIdentifier.flatMap { defaults.persistentDomain(forName: $0) } ?? [:]
        if !domain.isEmpty { return true }
        guard let support = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first else {
            return false
        }
        return FileManager.default.fileExists(atPath: support.appendingPathComponent("Plasticine").path)
    }
    var roots: [String] {
        get { defaults.stringArray(forKey: "roots") ?? [FileManager.default.homeDirectoryForCurrentUser.path] }
        set { defaults.set(newValue, forKey: "roots") }
    }
    var paused: Bool {
        get { defaults.bool(forKey: "paused") }
        set { defaults.set(newValue, forKey: "paused") }
    }
    var shortcut: Shortcut {
        get {
            guard let data = defaults.data(forKey: "shortcut"),
                  let saved = try? JSONDecoder().decode(Shortcut.self, from: data) else { return .standard }
            return saved
        }
        set {
            // This fixed struct contains only integers and a string, so encoding cannot fail.
            defaults.set(try! JSONEncoder().encode(newValue), forKey: "shortcut")
        }
    }
    var nodeName: String { String((Host.current().localizedName ?? "这台 Mac").prefix(60)) }

    func nodeID(for server: URL) -> String? { defaults.string(forKey: nodeKey(server)) }
    func setNodeID(_ id: String, for server: URL) { defaults.set(id, forKey: nodeKey(server)) }
    private func nodeKey(_ server: URL) -> String { "node." + Digest.hex(Data(server.absoluteString.utf8)) }
}
