import Foundation
import XCTest
@testable import PlasticineDevice

final class HelperProtocolTests: XCTestCase {
    func test一行请求解出id方法和参数() throws {
        let line = #"{"id":"r1","method":"files.read","params":{"path":"~/a.txt"}}"#
        let request = try XCTUnwrap(requestOf(HelperLine.decode(line)))
        XCTAssertEqual(request.id, "r1")
        XCTAssertEqual(request.method, "files.read")
        XCTAssertEqual(request.params, .object(["path": .string("~/a.txt")]))
    }

    func test没有params按空参数() throws {
        let request = try XCTUnwrap(requestOf(HelperLine.decode(#"{"id":"r2","method":"screenshot"}"#)))
        XCTAssertEqual(request.params, .null)
    }

    func test读不懂的行回id为null的错误() {
        let expected = HelperResponse.error(id: nil, HelperError(.invalidRequest, "这一行不是 JSON"))
        XCTAssertEqual(failure(HelperLine.decode("不是 JSON")), expected)
        guard case .error(nil, let error) = failure(HelperLine.decode(#"{"method":"screenshot"}"#)) else {
            return XCTFail("缺 id 要回 id 为 null 的错误")
        }
        XCTAssertEqual(error.code, .invalidRequest)
    }

    func test有id但方法缺失或多字段时带上id() {
        guard case .error("r3", let missing) = failure(HelperLine.decode(#"{"id":"r3"}"#)) else {
            return XCTFail("缺 method 要带上 id")
        }
        XCTAssertEqual(missing.code, .invalidRequest)
        guard case .error("r4", let extra) = failure(HelperLine.decode(#"{"id":"r4","method":"x","extra":1}"#)) else {
            return XCTFail("多字段要带上 id")
        }
        XCTAssertTrue(extra.message.contains("extra"))
        let arrayParams = HelperLine.decode(#"{"id":"r5","method":"x","params":[1]}"#)
        guard case .error("r5", let params) = failure(arrayParams) else {
            return XCTFail("params 不是对象要拒")
        }
        XCTAssertEqual(params.code, .invalidParams)
    }

    func test回执是一行且字段排好序() throws {
        let text = HelperLine.encode(.result(id: "r1", value: .object(["text": .string("第一行\n第二行 a/b")])))
        XCTAssertFalse(text.contains("\n"))
        XCTAssertEqual(text, #"{"id":"r1","result":{"text":"第一行\n第二行 a/b"}}"#)
        let error = HelperLine.encode(.error(id: nil, HelperError(.unknownMethod, "不会")))
        XCTAssertEqual(error, #"{"error":{"code":"unknown_method","message":"不会"},"id":null}"#)
    }

    func test设备错误换成协议错误码() {
        XCTAssertEqual(HelperError.from(DeviceFailure.refused("不在授权目录内")).code, .refused)
        XCTAssertEqual(HelperError.from(DeviceFailure.failed("坏了")).message, "坏了")
        XCTAssertEqual(HelperError.from(DeviceFailure.stale).code, .screenshotStale)
        XCTAssertEqual(HelperError.from(CancellationError()).code, .cancelled)
        XCTAssertEqual(HelperError.from(HelperError(.notFound, "没有")).code, .notFound)
    }

    private func failure(_ decoded: HelperDecoded) -> HelperResponse? {
        if case .rejected(let response) = decoded { return response }
        return nil
    }

    private func requestOf(_ decoded: HelperDecoded) -> HelperRequest? {
        if case .request(let request) = decoded { return request }
        return nil
    }
}
