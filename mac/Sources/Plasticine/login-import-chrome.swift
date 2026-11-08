import CommonCrypto
import Foundation
import Security
import SQLite3

// 从 Chrome 搬一次登录（2026-11-04 第 3 批，他定；只在他点「导入」时在本机做，不经服务器、不进日志）：
// - Cookie：~/Library/Application Support/Google/Chrome/Default/Cookies（SQLite）。值是加密的：钥匙存在登录钥匙串的
//   「Chrome Safe Storage」里（读它时系统弹框问他允不允许），PBKDF2-HMAC-SHA1（盐 saltysalt、1003 次、16 字节）
//   派生 AES-128 钥匙，AES-CBC（IV 是 16 个空格）解开 v10 开头的值；库版本 24 起解开的明文前面多 32 字节的域名摘要。
// - 密码不导（第 6 条，他 2026-11-05 定：全部不用钥匙串，网站只记登录状态）：不读 Login Data。
// Chrome 开着时库是锁着的：先复制一份到临时目录再读，读完删掉。解不开的条目跳过并计数，不猜。
// 注意：这台机器没有 Xcode，这份第 3 批写的时候没能编译，等 GitHub macOS 机器上跑 swift build / swift test 和真 App；
// 「Chrome Safe Storage」的授权框、库版本 24 的前缀都要在他的 Mac 上实测。

struct ChromeCookie {
    let domain: String
    let name: String
    let value: String
    let path: String
    let expires: Date?
    let secure: Bool
    let httpOnly: Bool
    let sameSite: Int
}

enum ChromeProfile {
    static var directory: URL {
        FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent("Library/Application Support/Google/Chrome/Default")
    }

    static var available: Bool {
        FileManager.default.fileExists(atPath: directory.appendingPathComponent("Cookies").path)
    }
}

enum ChromeCrypto {
    private static let salt = "saltysalt"
    private static let rounds: UInt32 = 1003
    private static let keyLength = 16
    private static let prefix = Data("v10".utf8)
    /// Chrome 的 Cookie 库从这个版本起，解开的明文前面带 32 字节的域名 SHA-256。
    static let hashedDomainVersion = 24

    /// 读「Chrome Safe Storage」：系统会弹框问他允不允许 Plasticine 用；他不允许就是 nil。
    static func storageKey() throws -> Data {
        let request: [String: Any] = [kSecClass as String: kSecClassGenericPassword,
                                      kSecAttrService as String: "Chrome Safe Storage",
                                      kSecReturnData as String: true, kSecMatchLimit as String: kSecMatchLimitOne]
        var item: CFTypeRef?
        let status = SecItemCopyMatching(request as CFDictionary, &item)
        if status == errSecUserCanceled || status == errSecAuthFailed {
            throw DeviceFailure.refused("你没有允许 Plasticine 读「Chrome Safe Storage」，没有导入。")
        }
        guard status == errSecSuccess, let secret = item as? Data else {
            throw DeviceFailure.failed("钥匙串里没有找到「Chrome Safe Storage」（\(status)）：Chrome 装过、登录过吗？")
        }
        return try derive(secret)
    }

    static func derive(_ secret: Data) throws -> Data {
        var key = Data(count: keyLength)
        let saltBytes = Array(salt.utf8)
        let status = key.withUnsafeMutableBytes { keyBuffer in
            secret.withUnsafeBytes { secretBuffer in
                CCKeyDerivationPBKDF(CCPBKDFAlgorithm(kCCPBKDF2),
                                     secretBuffer.baseAddress?.assumingMemoryBound(to: Int8.self), secret.count,
                                     saltBytes, saltBytes.count, CCPseudoRandomAlgorithm(kCCPRFHmacAlgSHA1), rounds,
                                     keyBuffer.baseAddress?.assumingMemoryBound(to: UInt8.self), keyLength)
            }
        }
        guard status == kCCSuccess else { throw DeviceFailure.failed("Chrome 的钥匙派生没成。") }
        return key
    }

    /// 解开一个值；不是 v10 开头、解不开都是 nil（跳过，不猜）。
    static func decrypt(_ encrypted: Data, key: Data, dropDomainHash: Bool) -> String? {
        guard encrypted.count > prefix.count, encrypted.prefix(prefix.count) == prefix else { return nil }
        let body = encrypted.dropFirst(prefix.count)
        let iv = Data(repeating: 0x20, count: kCCBlockSizeAES128)
        var output = Data(count: body.count + kCCBlockSizeAES128)
        var written = 0
        let outputCount = output.count
        let status = output.withUnsafeMutableBytes { outBuffer in
            body.withUnsafeBytes { inBuffer in
                key.withUnsafeBytes { keyBuffer in
                    iv.withUnsafeBytes { ivBuffer in
                        CCCrypt(CCOperation(kCCDecrypt), CCAlgorithm(kCCAlgorithmAES), CCOptions(kCCOptionPKCS7Padding),
                                keyBuffer.baseAddress, key.count, ivBuffer.baseAddress, inBuffer.baseAddress, body.count,
                                outBuffer.baseAddress, outputCount, &written)
                    }
                }
            }
        }
        guard status == kCCSuccess else { return nil }
        var plain = output.prefix(written)
        if dropDomainHash {
            guard plain.count >= 32 else { return nil }
            plain = plain.dropFirst(32)
        }
        return String(data: plain, encoding: .utf8)
    }
}

/// 只读打开一份 SQLite 库的复制件（Chrome 开着时原库锁着）。
final class SQLiteCopy {
    private var handle: OpaquePointer?
    private let copy: URL

    init(_ source: URL) throws {
        copy = FileManager.default.temporaryDirectory.appendingPathComponent("plasticine-\(UUID().uuidString).db")
        do {
            try FileManager.default.copyItem(at: source, to: copy)
        } catch {
            throw DeviceFailure.failed("读不到 \(source.lastPathComponent)：\(error.localizedDescription)")
        }
        guard sqlite3_open_v2(copy.path, &handle, SQLITE_OPEN_READONLY, nil) == SQLITE_OK else {
            close()
            throw DeviceFailure.failed("\(source.lastPathComponent) 打不开，可能是 Chrome 新版改了格式。")
        }
    }

    deinit { close() }

    func close() {
        if handle != nil { sqlite3_close(handle) }
        handle = nil
        try? FileManager.default.removeItem(at: copy)
    }

    /// 一行一行读：每行交给 row（列号从 0 起）。
    func each(_ sql: String, _ row: (OpaquePointer) -> Void) throws {
        var statement: OpaquePointer?
        guard sqlite3_prepare_v2(handle, sql, -1, &statement, nil) == SQLITE_OK, let statement else {
            throw DeviceFailure.failed("Chrome 的库格式和预想的不一样，没能读。")
        }
        defer { sqlite3_finalize(statement) }
        while sqlite3_step(statement) == SQLITE_ROW { row(statement) }
    }

    static func text(_ statement: OpaquePointer, _ column: Int32) -> String {
        guard let pointer = sqlite3_column_text(statement, column) else { return "" }
        return String(cString: pointer)
    }

    static func blob(_ statement: OpaquePointer, _ column: Int32) -> Data {
        let count = Int(sqlite3_column_bytes(statement, column))
        guard count > 0, let pointer = sqlite3_column_blob(statement, column) else { return Data() }
        return Data(bytes: pointer, count: count)
    }
}

enum ChromeImport {
    /// 1601-01-01 到 1970-01-01 的微秒数（Chrome 的时间从 1601 年起算）。
    private static let windowsEpochMicros: Int64 = 11_644_473_600_000_000

    /// 有 Cookie 的网站数（不解密，只数域名）。
    static func siteCount() -> Int? {
        guard ChromeProfile.available,
              let database = try? SQLiteCopy(ChromeProfile.directory.appendingPathComponent("Cookies")) else { return nil }
        var hosts = Set<String>()
        try? database.each("SELECT host_key FROM cookies") { hosts.insert(LoginSites.site(of: SQLiteCopy.text($0, 0))) }
        return hosts.count
    }

    static func cookies(key: Data) throws -> (cookies: [ChromeCookie], skipped: Int) {
        let database = try SQLiteCopy(ChromeProfile.directory.appendingPathComponent("Cookies"))
        var version = 0
        try database.each("SELECT value FROM meta WHERE key = 'version'") { version = Int(SQLiteCopy.text($0, 0)) ?? 0 }
        let dropHash = version >= ChromeCrypto.hashedDomainVersion
        var found: [ChromeCookie] = []
        var skipped = 0
        let now = Date()
        try database.each("SELECT host_key, name, value, encrypted_value, path, expires_utc, is_secure, is_httponly, "
            + "samesite FROM cookies") { row in
            let plain = SQLiteCopy.text(row, 2)
            let value = plain.isEmpty ? ChromeCrypto.decrypt(SQLiteCopy.blob(row, 3), key: key, dropDomainHash: dropHash)
                : plain
            let micros = sqlite3_column_int64(row, 5)
            let expires = micros == 0 ? nil
                : Date(timeIntervalSince1970: Double(micros - windowsEpochMicros) / 1_000_000)
            guard let value, expires.map({ $0 > now }) ?? true else {
                skipped += 1
                return
            }
            found.append(ChromeCookie(domain: SQLiteCopy.text(row, 0), name: SQLiteCopy.text(row, 1), value: value,
                                      path: SQLiteCopy.text(row, 4), expires: expires,
                                      secure: sqlite3_column_int(row, 6) != 0, httpOnly: sqlite3_column_int(row, 7) != 0,
                                      sameSite: Int(sqlite3_column_int(row, 8))))
        }
        return (found, skipped)
    }

    static func httpCookie(_ cookie: ChromeCookie) -> HTTPCookie? {
        var properties: [HTTPCookiePropertyKey: Any] = [.domain: cookie.domain, .path: cookie.path.isEmpty ? "/"
            : cookie.path, .name: cookie.name, .value: cookie.value]
        if cookie.secure { properties[.secure] = "TRUE" }
        if let expires = cookie.expires { properties[.expires] = expires }
        if cookie.httpOnly { properties[HTTPCookiePropertyKey("HttpOnly")] = "TRUE" }
        // Chrome：0 none、1 lax、2 strict（-1 没写）。
        if cookie.sameSite == 1 { properties[.sameSitePolicy] = HTTPCookieStringPolicy.sameSiteLax }
        if cookie.sameSite == 2 { properties[.sameSitePolicy] = HTTPCookieStringPolicy.sameSiteStrict }
        return HTTPCookie(properties: properties)
    }
}
