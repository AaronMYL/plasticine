import Foundation
import XCTest
@testable import PlasticineDevice

final class BoundedOutputTests: XCTestCase {
    func test无效UTF8替换字符也不超过返回字节上限() {
        var output = BoundedOutput(limit: 4)
        output.append(Data([0xFF, 0xFF, 0xFF, 0xFF]))
        XCTAssertLessThanOrEqual(output.text.utf8.count, 4)
        XCTAssertTrue(output.truncated)
    }

    func test截断按字节计算且不拆开中文() {
        var output = BoundedOutput(limit: 5)
        output.append(Data("你好吗".utf8))
        XCTAssertEqual(output.text, "你")
        XCTAssertTrue(output.truncated)
        XCTAssertLessThanOrEqual(output.data.count, 5)
    }

    func test刚好达到上限不标记截断并支持分块字符() {
        var output = BoundedOutput(limit: 6)
        let bytes = Data("你好".utf8)
        output.append(bytes.prefix(2))
        output.append(bytes.dropFirst(2))
        XCTAssertEqual(output.text, "你好")
        XCTAssertFalse(output.truncated)
        output.append(Data([65]))
        XCTAssertTrue(output.truncated)
        XCTAssertEqual(output.text, "你好")
    }
}
