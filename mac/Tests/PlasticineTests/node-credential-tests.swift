import Foundation
import XCTest
@testable import Plasticine

// 第 6 条：配对凭证存 App 自己的受保护文件；文件里没有时从旧钥匙串搬一次，之后不再碰钥匙串（不碰真钥匙串）。

final class NodeCredentialStoreTests: XCTestCase {
    private var base: URL!
    private let server = URL(string: "https://203.0.113.10/")!

    override func setUpWithError() throws {
        base = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    }

    override func tearDownWithError() throws {
        try? FileManager.default.removeItem(at: base)
    }

    private func permissions(_ url: URL) throws -> Int {
        let attributes = try FileManager.default.attributesOfItem(atPath: url.path)
        return (attributes[.posixPermissions] as? NSNumber)?.intValue ?? -1
    }

    func test存进文件_目录0700文件0600_按服务器分开() throws {
        try NodeCredentialStore.save("secret-a", server: server, base: base)
        let other = URL(string: "https://example.com:8443/")!
        try NodeCredentialStore.save("secret-b", server: other, base: base)
        let file = try NodeCredentialStore.location(server, base: base)
        XCTAssertEqual(try permissions(file), 0o600)
        XCTAssertEqual(try permissions(file.deletingLastPathComponent()), 0o700)
        XCTAssertEqual(file.deletingLastPathComponent().lastPathComponent, "node-credential")
        let neverKeychain: (URL) throws -> String? = { _ in
            XCTFail("文件里有就不该读钥匙串")
            return nil
        }
        XCTAssertEqual(try NodeCredentialStore.read(server: server, base: base, legacy: neverKeychain), "secret-a")
        XCTAssertEqual(try NodeCredentialStore.read(server: other, base: base, legacy: neverKeychain), "secret-b")
    }

    func test重新配对覆盖旧凭证_目录里不留临时文件() throws {
        try NodeCredentialStore.save("old", server: server, base: base)
        try NodeCredentialStore.save("new", server: server, base: base)
        XCTAssertEqual(try NodeCredentialStore.read(server: server, base: base, legacy: { _ in nil }), "new")
        let directory = try NodeCredentialStore.location(server, base: base).deletingLastPathComponent()
        XCTAssertEqual(try FileManager.default.contentsOfDirectory(atPath: directory.path).count, 1)
        XCTAssertThrowsError(try NodeCredentialStore.save("", server: server, base: base))
    }

    func test文件里没有时从旧钥匙串搬一次_之后不再读钥匙串() throws {
        var asked = 0
        let legacy: (URL) throws -> String? = { _ in
            asked += 1
            return "from-keychain"
        }
        XCTAssertEqual(try NodeCredentialStore.read(server: server, base: base, legacy: legacy), "from-keychain")
        XCTAssertEqual(try NodeCredentialStore.read(server: server, base: base, legacy: legacy), "from-keychain")
        XCTAssertEqual(asked, 1)
        XCTAssertEqual(try permissions(try NodeCredentialStore.location(server, base: base)), 0o600)
    }

    // 11-05：启动时设备服务和检查更新同时来读，旧钥匙串也只问一次。
    func test同时来读_旧钥匙串只问一次() throws {
        let counter = NSLock()
        var asked = 0
        let legacy: (URL) throws -> String? = { _ in
            counter.lock()
            asked += 1
            counter.unlock()
            Thread.sleep(forTimeInterval: 0.05)
            return "from-keychain"
        }
        let server = self.server
        let base = self.base!
        DispatchQueue.concurrentPerform(iterations: 4) { _ in
            XCTAssertEqual(try? NodeCredentialStore.read(server: server, base: base, legacy: legacy), "from-keychain")
        }
        XCTAssertEqual(asked, 1)
    }

    func test旧钥匙串也没有就记下查过了_不再问第二次() throws {
        var asked = 0
        let legacy: (URL) throws -> String? = { _ in
            asked += 1
            return nil
        }
        XCTAssertNil(try NodeCredentialStore.read(server: server, base: base, legacy: legacy))
        XCTAssertNil(try NodeCredentialStore.read(server: server, base: base, legacy: legacy))
        XCTAssertEqual(asked, 1)
        try NodeCredentialStore.save("paired", server: server, base: base)
        XCTAssertEqual(try NodeCredentialStore.read(server: server, base: base, legacy: legacy), "paired")
    }

    func test读旧钥匙串出错时不记查过_下次再试() throws {
        var asked = 0
        let legacy: (URL) throws -> String? = { _ in
            asked += 1
            throw DeviceFailure.failed("locked")
        }
        XCTAssertThrowsError(try NodeCredentialStore.read(server: server, base: base, legacy: legacy))
        XCTAssertThrowsError(try NodeCredentialStore.read(server: server, base: base, legacy: legacy))
        XCTAssertEqual(asked, 2)
    }
}
