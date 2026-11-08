import Foundation
import XCTest
@testable import PlasticineDevice

@MainActor
private final class FakeHandler: HelperHandling {
    func handle(_ request: HelperRequest) async throws -> JSONValue {
        switch request.method {
        case "echo": return request.params
        case "wait":
            // 一直等到被取消。
            while true {
                try Task.checkCancellation()
                try await Task.sleep(nanoseconds: 5_000_000)
            }
        default: throw HelperError(.unknownMethod, "不会")
        }
    }
}

@MainActor
final class HelperServerTests: XCTestCase {
    private var lines: [String] = []

    private func server() -> HelperServer {
        HelperServer(handler: FakeHandler(), write: { [weak self] line in self?.lines.append(line) })
    }

    private func settle(_ server: HelperServer) async {
        for _ in 0..<200 where server.inFlight > 0 {
            try? await Task.sleep(nanoseconds: 5_000_000)
        }
    }

    func test请求做完回同一个id() async {
        let server = server()
        server.receive(#"{"id":"a","method":"echo","params":{"x":1}}"#)
        await settle(server)
        XCTAssertEqual(lines, [#"{"id":"a","result":{"x":1}}"#])
    }

    func test坏行和空行() async {
        let server = server()
        server.receive("")
        server.receive("{")
        XCTAssertEqual(lines.count, 1)
        XCTAssertTrue(lines[0].contains(#""code":"invalid_request""#))
    }

    func test取消在做的请求它自己回cancelled() async {
        let server = server()
        server.receive(#"{"id":"long","method":"wait"}"#)
        server.receive(#"{"id":"long","method":"wait"}"#)
        XCTAssertTrue(lines[0].contains("duplicate_id"))
        server.receive(#"{"id":"c1","method":"cancel","params":{"requestId":"long"}}"#)
        XCTAssertEqual(lines[1], #"{"id":"c1","result":{"cancelled":true}}"#)
        await settle(server)
        XCTAssertEqual(lines[2], #"{"error":{"code":"cancelled","message":"已取消，可能已产生部分结果，请先核实。"},"id":"long"}"#)
        server.receive(#"{"id":"c2","method":"cancel","params":{"requestId":"long"}}"#)
        XCTAssertEqual(lines[3], #"{"id":"c2","result":{"cancelled":false}}"#)
    }

    func test处理出错回错误码() async {
        let server = server()
        server.receive(#"{"id":"x","method":"nope"}"#)
        await settle(server)
        XCTAssertEqual(lines, [#"{"error":{"code":"unknown_method","message":"不会"},"id":"x"}"#])
    }
}
