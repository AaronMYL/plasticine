import Foundation

// 自签代码签名身份（只自用）：首次在登录钥匙串生成一张「Plasticine Local Signing」自签证书，
// 之后每次更新都用它 codesign --force --deep -s 重签，签名身份固定——更新后屏幕录制 / 辅助功能权限不丢。
// 全程用系统自带的 security / openssl。私钥、证书、一次性口令只在临时目录里存在，用完即删，不进仓库、不进日志。
enum SelfSigning {
    static let identityName = "Plasticine Local Signing"

    /// 返回可用于 `codesign -s` 的身份名；没有就先生成一张。
    static func ensureIdentity() throws -> String {
        if hasCertificate() { return identityName }
        try generate()
        return identityName
    }

    /// 登录钥匙串里是否已有这张证书（避免重复生成）。
    static func hasCertificate() -> Bool {
        guard let result = try? Subprocess.run(
            "/usr/bin/security", ["find-certificate", "-c", identityName, loginKeychain()]
        ) else {
            return false
        }
        return result.ok
    }

    private static func generate() throws {
        let directory = try FileManager.default.url(
            for: .itemReplacementDirectory, in: .userDomainMask,
            appropriateFor: FileManager.default.homeDirectoryForCurrentUser, create: true
        )
        // 临时的私钥、证书、口令随目录一起删掉，不留痕。
        defer { try? FileManager.default.removeItem(at: directory) }
        let key = directory.appendingPathComponent("key.pem")
        let certificate = directory.appendingPathComponent("cert.pem")
        let bundle = directory.appendingPathComponent("identity.p12")
        let config = directory.appendingPathComponent("openssl.cnf")
        try opensslConfig().write(to: config, atomically: true, encoding: .utf8)
        let made = try Subprocess.run("/usr/bin/openssl", [
            "req", "-x509", "-newkey", "rsa:2048", "-keyout", key.path, "-out", certificate.path,
            "-days", "3650", "-nodes", "-subj", "/CN=\(identityName)", "-config", config.path,
            "-extensions", "codesign"
        ])
        guard made.ok else { throw DeviceFailure.failed("无法生成自签证书，请确认系统自带 openssl 可用。") }
        // 随机一次性口令只用于导入，不落盘到临时目录以外的地方。
        let passphrase = UUID().uuidString
        let packed = try Subprocess.run("/usr/bin/openssl", [
            "pkcs12", "-export", "-inkey", key.path, "-in", certificate.path,
            "-name", identityName, "-out", bundle.path, "-passout", "stdin"
        ], input: Data((passphrase + "\n").utf8))
        guard packed.ok else { throw DeviceFailure.failed("无法打包自签证书。") }
        // 导入登录钥匙串并把 codesign 加进私钥的使用许可（首次重签时系统会问一次，请选「始终允许」）。
        let imported = try Subprocess.run("/usr/bin/security", [
            "import", bundle.path, "-k", loginKeychain(), "-P", passphrase, "-T", "/usr/bin/codesign", "-x"
        ])
        guard imported.ok else { throw DeviceFailure.failed("无法把自签证书导入登录钥匙串。") }
    }

    private static func loginKeychain() -> String {
        let candidate = FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent("Library/Keychains/login.keychain-db")
        return FileManager.default.fileExists(atPath: candidate.path) ? candidate.path : "login.keychain"
    }

    private static func opensslConfig() -> String {
        """
        [req]
        distinguished_name = dn
        [dn]
        [codesign]
        basicConstraints = critical,CA:false
        keyUsage = critical,digitalSignature
        extendedKeyUsage = critical,codeSigning
        """
    }
}
