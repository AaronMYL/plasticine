import CommonCrypto
import XCTest
@testable import Plasticine

// 第 3 批：登录的消息、网站归并、Safari binarycookies 的读法、Chrome 值的解密（不碰真钥匙串和真浏览器数据）。
// 注意：这台机器没有 Xcode，这份写的时候没能跑，等 GitHub macOS 机器上 swift test。

final class LoginTests: XCTestCase {
    func test登录消息只收认得的几种() throws {
        XCTAssertEqual(try LoginsMessage.parse(["type": "sites"]), .sites)
        // 第 6 条：只导登录状态；旧网页带的 passwords 收下不用，没带也认。
        XCTAssertEqual(try LoginsMessage.parse(["type": "import", "from": "chrome", "passwords": true]),
                       .importFrom(source: "chrome"))
        XCTAssertEqual(try LoginsMessage.parse(["type": "import", "from": "safari"]), .importFrom(source: "safari"))
        XCTAssertEqual(try LoginsMessage.parse(["type": "forget", "host": "x.com"]), .forget(host: "x.com"))
        XCTAssertThrowsError(try LoginsMessage.parse(["type": "import", "from": "firefox", "passwords": true]))
        XCTAssertThrowsError(try LoginsMessage.parse(["type": "import"]))
        XCTAssertThrowsError(try LoginsMessage.parse(["type": "dump"]))
    }

    func test域名归到网站_两级公共后缀多取一级() {
        XCTAssertEqual(LoginSites.site(of: ".x.com"), "x.com")
        XCTAssertEqual(LoginSites.site(of: "console.cloud.tencent.com"), "tencent.com")
        XCTAssertEqual(LoginSites.site(of: "passport.example.com.cn"), "example.com.cn")
        XCTAssertEqual(LoginSites.displayName("github.com"), "Github")
    }

    func testSafari的binarycookies读出域名名字值和过期() throws {
        func le32(_ value: Int) -> [UInt8] { (0..<4).map { UInt8((value >> ($0 * 8)) & 0xff) } }
        func be32(_ value: Int) -> [UInt8] { le32(value).reversed() }
        let strings = Array(".x.com\0auth_token\0/\0secret\0".utf8)
        let expires = Date().addingTimeInterval(86_400).timeIntervalSinceReferenceDate
        let expiry = withUnsafeBytes(of: expires.bitPattern.littleEndian) { Array($0) }
        var cookie = le32(56 + strings.count) + le32(0) + le32(5) + le32(0)
        cookie += le32(56) + le32(63) + le32(74) + le32(76) + [UInt8](repeating: 0, count: 8) + expiry
        cookie += [UInt8](repeating: 0, count: 8) + strings
        let page = [0, 0, 1, 0] + le32(1) + le32(12) + cookie
        let file = Array("cook".utf8) + be32(1) + be32(page.count) + page
        let read = try SafariCookies.parse(Data(file), now: Date())
        XCTAssertEqual(read.skipped, 0)
        XCTAssertEqual(read.cookies.first?.domain, ".x.com")
        XCTAssertEqual(read.cookies.first?.name, "auth_token")
        XCTAssertEqual(read.cookies.first?.value, "secret")
        XCTAssertEqual(read.cookies.first?.secure, true)
        XCTAssertEqual(read.cookies.first?.httpOnly, true)
        XCTAssertThrowsError(try SafariCookies.parse(Data("nope".utf8), now: Date()))
    }

    func testChrome的值按v10解开_库版本24去掉前面32字节() throws {
        let key = try ChromeCrypto.derive(Data("peanuts".utf8))
        func encrypt(_ plain: Data) -> Data {
            let iv = Data(repeating: 0x20, count: kCCBlockSizeAES128)
            var output = Data(count: plain.count + kCCBlockSizeAES128)
            var written = 0
            let outputCount = output.count
            _ = output.withUnsafeMutableBytes { out in
                plain.withUnsafeBytes { input in
                    key.withUnsafeBytes { keyBytes in
                        iv.withUnsafeBytes { ivBytes in
                            CCCrypt(CCOperation(kCCEncrypt), CCAlgorithm(kCCAlgorithmAES),
                                    CCOptions(kCCOptionPKCS7Padding), keyBytes.baseAddress, key.count,
                                    ivBytes.baseAddress, input.baseAddress, plain.count, out.baseAddress, outputCount,
                                    &written)
                        }
                    }
                }
            }
            return Data("v10".utf8) + output.prefix(written)
        }
        XCTAssertEqual(ChromeCrypto.decrypt(encrypt(Data("abc".utf8)), key: key, dropDomainHash: false), "abc")
        let hashed = Data(repeating: 7, count: 32) + Data("abc".utf8)
        XCTAssertEqual(ChromeCrypto.decrypt(encrypt(hashed), key: key, dropDomainHash: true), "abc")
        XCTAssertNil(ChromeCrypto.decrypt(Data("v11xxxx".utf8), key: key, dropDomainHash: false))
    }
}
