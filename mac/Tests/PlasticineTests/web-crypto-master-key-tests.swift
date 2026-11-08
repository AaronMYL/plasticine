import Foundation
import XCTest
@testable import Plasticine

// 11-05：WebKit 的 WebCrypto 主密钥由 Plasticine 自己存在文件里交给 WebKit，不进钥匙串。
final class WebCryptoMasterKeyTests: XCTestCase {
    func test第一次生成16字节_之后一直是同一把_文件0600() throws {
        let base = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: base) }
        let first = try XCTUnwrap(WebCryptoMasterKey.data(base: base))
        XCTAssertEqual(first.count, 16)
        XCTAssertEqual(WebCryptoMasterKey.data(base: base), first)
        let file = try WebCryptoMasterKey.location(base: base)
        let attributes = try FileManager.default.attributesOfItem(atPath: file.path)
        XCTAssertEqual((attributes[.posixPermissions] as? NSNumber)?.intValue, 0o600)
        let folder = try FileManager.default.attributesOfItem(atPath: file.deletingLastPathComponent().path)
        XCTAssertEqual((folder[.posixPermissions] as? NSNumber)?.intValue, 0o700)
    }

    func test网页代理都交自己的主密钥() {
        let selector = NSSelectorFromString("_webCryptoMasterKeyForWebView:")
        XCTAssertTrue(WebTabDelegate.instancesRespond(to: selector))
        XCTAssertTrue(WebWindow.instancesRespond(to: selector))
        XCTAssertTrue(XTimelineReader.instancesRespond(to: selector))
    }
}
