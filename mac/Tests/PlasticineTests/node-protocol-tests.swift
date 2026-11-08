import Foundation
import XCTest
@testable import Plasticine

final class NodeProtocolTests: XCTestCase {
    func test长轮询参数按共享判别字段解码() throws {
        let data = Data(#"""
        {"action":{"id":"a1","kind":"file_write","deadline":"2026-10-29T20:00:00.000Z",
        "params":{"kind":"file_write","path":"~/笔记.txt","content":"你好","baseVersion":null}}}
        """#.utf8)
        let envelope = try JSONDecoder().decode(NextAction.self, from: data)
        let params = try envelope.action.validatedParams()
        XCTAssertEqual(params.path, "~/笔记.txt")
        XCTAssertNil(params.baseVersion)
        XCTAssertNotNil(envelope.action.expiry)
    }

    func test服务器发的参数里没有种类也能解码() throws {
        let data = Data(#"""
        {"action":{"id":"a3","kind":"run_command","deadline":"2026-10-29T20:00:00.000Z",
        "params":{"cwd":"~","command":"sw_vers"}}}
        """#.utf8)
        let params = try JSONDecoder().decode(NextAction.self, from: data).action.validatedParams()
        XCTAssertEqual(params.kind, .runCommand)
        XCTAssertEqual(params.command, "sw_vers")
    }

    func test参数缺少版本或种类不一致时拒绝() throws {
        let missing = Data(#"{"kind":"file_write","path":"~/a","content":"a"}"#.utf8)
        XCTAssertThrowsError(try JSONDecoder().decode(ActionParams.self, from: missing).validate())
        let mismatch = Data(#"""
        {"action":{"id":"a2","kind":"file_read","deadline":"2026-10-29T20:00:00Z",
        "params":{"kind":"file_delete","path":"~/a"}}}
        """#.utf8)
        let envelope = try JSONDecoder().decode(NextAction.self, from: mismatch)
        XCTAssertThrowsError(try envelope.action.validatedParams())
    }

    func test回执只编码长轮询协议字段() throws {
        let report = ActionReport.refused("不在授权目录内")
        let object = try JSONDecoder().decode(JSONValue.self, from: JSONEncoder().encode(report))
        XCTAssertEqual(object, .object([
            "status": .string("refused"), "error": .string("不在授权目录内"),
            "refusalLayer": .string("device")
        ]))
    }

    func test截图失效回执带errorCode而不带结果() throws {
        let object = try JSONDecoder().decode(JSONValue.self, from: JSONEncoder().encode(ActionReport.stale()))
        guard case .object(let fields) = object else { return XCTFail("回执应是对象") }
        XCTAssertEqual(fields["status"], .string("failed"))
        XCTAssertEqual(fields["errorCode"], .string("screenshot_stale"))
        XCTAssertNil(fields["result"])
        XCTAssertNil(fields["refusalLayer"])
    }

    func testhello上报空闲秒数() throws {
        let request = HelloRequest(capabilities: [.fileRead], idleSeconds: 42)
        let object = try JSONDecoder().decode(JSONValue.self, from: JSONEncoder().encode(request))
        guard case .object(let fields) = object else { return XCTFail("hello 应是对象") }
        XCTAssertEqual(fields["idleSeconds"], .number(42))
        XCTAssertEqual(fields["protocolVersion"], .number(1))
    }

    func test设备上限解码容忍未知键并读取payments() throws {
        let data = Data(#"""
        {"roots":[],"apps":[],"sites":[],"unattendedInput":false,"payments":"deny","futureKey":123,
        "classes":{"read":{"mode":"allow","perHour":100},"write":{"mode":"confirm_each","perHour":10},
        "delete":{"mode":"confirm_each","perHour":10},"command":{"mode":"deny","perHour":0},
        "browser":{"mode":"allow","perHour":50},"input":{"mode":"allow","perHour":50}}}
        """#.utf8)
        let limits = try JSONDecoder().decode(DeviceLimits.self, from: data)
        XCTAssertEqual(limits.payments, "deny")
        XCTAssertEqual(limits.classes["read"]?.perHour, 100)
    }

    func test服务器必须是无凭据的HTTPS源地址() throws {
        XCTAssertEqual(try ServerAddress.parse("https://example.com:8443/").absoluteString,
                       "https://example.com:8443/")
        XCTAssertThrowsError(try ServerAddress.parse("http://example.com"))
        XCTAssertThrowsError(try ServerAddress.parse("https://user:pass@example.com"))
        XCTAssertThrowsError(try ServerAddress.parse("https://example.com/path"))
    }

    func test节点配对认HTTPS和这台Mac自己的本机服务() throws {
        XCTAssertTrue(ServerAddress.pairable(try ServerAddress.parse("https://203.0.113.10/")))
        XCTAssertTrue(ServerAddress.pairable(LocalServerAddress.url))
        XCTAssertTrue(ServerAddress.pairable(URL(string: "http://localhost:8790/")!))
        XCTAssertFalse(ServerAddress.pairable(URL(string: "http://example.com/")!))
        XCTAssertFalse(ServerAddress.pairable(URL(string: "http://192.168.1.5:8790/")!))
    }

    func test同源按协议的默认端口比() {
        let plain = URL(string: "http://127.0.0.1/a")!
        XCTAssertTrue(ServerAddress.sameOrigin(plain, URL(string: "http://127.0.0.1:80/")!))
        XCTAssertFalse(ServerAddress.sameOrigin(plain, URL(string: "http://127.0.0.1:443/")!))
        XCTAssertTrue(ServerAddress.sameOrigin(URL(string: "https://a.test/x")!, URL(string: "https://a.test:443/")!))
    }
}
