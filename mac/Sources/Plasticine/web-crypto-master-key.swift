import Darwin
import Foundation
import Security
import WebKit

// 11-05 他反馈：0.7.1 打开后系统又弹「Plasticine 想要访问你的钥匙串中的密钥 “Plasticine WebCrypto Master Key”」。
// 那是 WebKit 自己的：网页（比如腾讯云登录页）把 WebCrypto 的密钥存进 IndexedDB 时，WebKit 要一把「主密钥」来加密它，
// 默认存在钥匙串里、名字是「<App 名> WebCrypto Master Key」；钥匙串条目认 App 的签名，每次更新签名一变就弹框。
// 按他定的「全部不用钥匙串」：由导航代理通过 WebKit 的 _webCryptoMasterKeyForWebView: 交一把我们自己的主密钥，
// 存在 ~/Library/Application Support/Plasticine/webcrypto/master-key（目录 0700、文件 0600，16 字节随机），WebKit 就不再去碰钥匙串。
// 代价：以前用钥匙串那把主密钥存进网页数据里的 WebCrypto 密钥解不开了，个别网站可能要重新登录一次。
// 钥匙串里旧的那一项不删（规矩：不删数据）。
enum WebCryptoMasterKey {
    private static let lock = NSLock()
    private static var cached: Data?

    /// 这台 Mac 上 Plasticine 所有网页视图共用的主密钥；第一次用时生成。base：测试用的根目录。
    static func data(base: URL? = nil) -> Data? {
        lock.lock()
        defer { lock.unlock() }
        if base == nil, let cached { return cached }
        guard let file = try? location(base: base) else { return nil }
        if let existing = try? Data(contentsOf: file), existing.count == 16 {
            if base == nil { cached = existing }
            return existing
        }
        var bytes = [UInt8](repeating: 0, count: 16)
        guard SecRandomCopyBytes(kSecRandomDefault, bytes.count, &bytes) == errSecSuccess else { return nil }
        let key = Data(bytes)
        let temporary = file.deletingLastPathComponent().appendingPathComponent(".master-key." + UUID().uuidString)
        guard FileManager.default.createFile(atPath: temporary.path, contents: key,
                                             attributes: [.posixPermissions: 0o600]) else { return nil }
        guard Darwin.rename(temporary.path, file.path) == 0 else {
            try? FileManager.default.removeItem(at: temporary)
            return nil
        }
        if base == nil { cached = key }
        return key
    }

    static func location(base: URL? = nil) throws -> URL {
        let support = try base ?? FileManager.default.url(
            for: .applicationSupportDirectory, in: .userDomainMask, appropriateFor: nil, create: true
        )
        let directory = support.appendingPathComponent("Plasticine/webcrypto")
        try FileManager.default.createDirectory(
            at: directory, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700]
        )
        try FileManager.default.setAttributes([.posixPermissions: 0o700], ofItemAtPath: directory.path)
        return directory.appendingPathComponent("master-key")
    }
}
