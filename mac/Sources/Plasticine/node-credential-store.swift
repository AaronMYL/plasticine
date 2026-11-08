import Darwin
import Foundation
import Security

// 第 6 条（他 2026-11-05 定：全部不用钥匙串）：这台 Mac 和服务器配对的节点凭证存在 App 自己的受保护文件里，
// 不再存钥匙串——钥匙串条目认 App 的签名，每次更新签名一变系统就弹框问授权。
// 位置：~/Library/Application Support/Plasticine/node-credential/<服务器地址的 SHA-256>，按服务器分开；
// 目录 0700、文件 0600（只有他的账户能读），先写同目录的临时文件再改名，原子替换。凭证不写日志、不回显、不进错误信息。
//
// 一次性迁移：0.6.0 及以前存在钥匙串（service com.plasticine.app.node，account 是服务器地址）。文件里没有时读一次
// 旧钥匙串项——这是最后一次可能弹框——读到就写进文件；没有（或他没允许）就记一笔「查过了」，之后都不再碰钥匙串，
// 按没配对处理（菜单显示「需要配对」）。旧钥匙串项不删（规矩：不删数据）。
// 注意：这台机器没有 Xcode，写的时候没能编译，等 GitHub macOS 机器上跑 swift build / swift test。

enum NodeCredentialStore {
    private static let folder = "Plasticine/node-credential"
    /// 11-05 他反馈新版一打开弹了两次钥匙串授权：启动时设备服务和自动检查更新同时来读，文件里都还没有，就各读了一次
    /// 旧钥匙串。读（含迁移）一律排队，前一个写好文件，后一个直接读文件，旧钥匙串最多只问一次。
    private static let lock = NSLock()

    /// 这台 Mac 在这个服务器上的节点凭证；没有就是 nil。
    /// - Parameters:
    ///   - base: 测试用的根目录，默认是用户的 Application Support。
    ///   - legacy: 读旧钥匙串项（只在文件里没有、也没查过时调一次）。
    static func read(
        server: URL, base: URL? = nil, legacy: (URL) throws -> String? = LegacyNodeKeychain.read(server:)
    ) throws -> String? {
        lock.lock()
        defer { lock.unlock() }
        let file = try location(server, base: base)
        if FileManager.default.fileExists(atPath: file.path) {
            let data: Data
            do { data = try Data(contentsOf: file) } catch {
                throw DeviceFailure.failed("读不到这台 Mac 的配对凭证文件，请检查磁盘后重试，或重新配对。")
            }
            guard let value = String(data: data, encoding: .utf8), !value.isEmpty else {
                throw DeviceFailure.failed("配对凭证文件内容不对，请重新配对这台 Mac。")
            }
            return value
        }
        // 「查过旧钥匙串、没有」的记号：空文件，只为不再问第二次。
        let checked = file.appendingPathExtension("checked")
        if FileManager.default.fileExists(atPath: checked.path) { return nil }
        guard let migrated = try legacy(server) else {
            try write(Data(), to: checked)
            return nil
        }
        try saveUnlocked(migrated, server: server, base: base)
        return migrated
    }

    static func save(_ credential: String, server: URL, base: URL? = nil) throws {
        lock.lock()
        defer { lock.unlock() }
        try saveUnlocked(credential, server: server, base: base)
    }

    private static func saveUnlocked(_ credential: String, server: URL, base: URL?) throws {
        guard !credential.isEmpty else { throw DeviceFailure.failed("配对回答缺少凭证，请重新配对。") }
        try write(Data(credential.utf8), to: try location(server, base: base))
    }

    /// 凭证文件的路径；顺手建好 0700 的目录（已有的也收紧到 0700）。
    static func location(_ server: URL, base: URL? = nil) throws -> URL {
        let support = try base ?? FileManager.default.url(
            for: .applicationSupportDirectory, in: .userDomainMask, appropriateFor: nil, create: true
        )
        let directory = support.appendingPathComponent(folder)
        do {
            try FileManager.default.createDirectory(
                at: directory, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700]
            )
            try FileManager.default.setAttributes([.posixPermissions: 0o700], ofItemAtPath: directory.path)
        } catch {
            throw DeviceFailure.failed("没能建好存配对凭证的目录，请检查磁盘权限后重试。")
        }
        return directory.appendingPathComponent(Digest.hex(Data(server.absoluteString.utf8)))
    }

    /// 先写同目录的临时文件（0600），再 rename 换上去：要么是旧的，要么是完整的新的。
    private static func write(_ data: Data, to file: URL) throws {
        let temporary = file.deletingLastPathComponent()
            .appendingPathComponent("." + file.lastPathComponent + "." + UUID().uuidString)
        guard FileManager.default.createFile(
            atPath: temporary.path, contents: data, attributes: [.posixPermissions: 0o600]
        ) else {
            throw DeviceFailure.failed("没能保存配对凭证，请检查磁盘后重试配对。")
        }
        guard Darwin.rename(temporary.path, file.path) == 0 else {
            try? FileManager.default.removeItem(at: temporary)
            throw DeviceFailure.failed("没能保存配对凭证，请检查磁盘后重试配对。")
        }
    }
}

/// 0.6.0 及以前的钥匙串存法，只为一次性迁移读；不写、不删。
enum LegacyNodeKeychain {
    private static let service = "com.plasticine.app.node"

    static func read(server: URL) throws -> String? {
        let request: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service,
            kSecAttrAccount as String: server.absoluteString, kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne
        ]
        var item: CFTypeRef?
        let status = SecItemCopyMatching(request as CFDictionary, &item)
        // 没有，或他在弹框里没允许：都按没配对处理，不再问第二次。
        if status == errSecItemNotFound || status == errSecUserCanceled || status == errSecAuthFailed { return nil }
        guard status == errSecSuccess, let data = item as? Data,
              let value = String(data: data, encoding: .utf8), !value.isEmpty else {
            throw DeviceFailure.failed("无法读取旧的配对凭证（钥匙串 \(status)），请解锁钥匙串后重试，或重新配对。")
        }
        return value
    }
}
