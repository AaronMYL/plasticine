import Foundation
import XCTest
@testable import Plasticine

// 沉浸式翻译（0.4.0）的纯逻辑：网页界面的命令、注入脚本的消息、付款页判法、注入的脚本本身。
final class WebTranslateTests: XCTestCase {
    func test开关命令按协议解析_形状不对一律拒() throws {
        let on: [String: Any] = ["type": "configure", "tabId": "web:1",
                                 "config": ["run": "r-1", "target": "zh-CN", "display": "bilingual"]]
        XCTAssertEqual(try TranslateCommand.parse(on),
                       .configure("web:1", TranslatePageConfig(run: "r-1", target: "zh-CN", display: "bilingual")))
        let off: [String: Any] = ["type": "configure", "tabId": "web:1", "config": NSNull()]
        XCTAssertEqual(try TranslateCommand.parse(off), .configure("web:1", nil))
        for bad in [["run": "r 1", "target": "zh-CN", "display": "bilingual"],
                    ["run": "r1", "target": "klingon", "display": "bilingual"],
                    ["run": "r1", "target": "zh-CN", "display": "sideways"]] {
            XCTAssertThrowsError(try TranslateCommand.parse(["type": "configure", "tabId": "t", "config": bad]))
        }
        XCTAssertThrowsError(try TranslateCommand.parse(["type": "eval", "tabId": "t"]))
        XCTAssertThrowsError(try TranslateCommand.parse(["type": "configure", "config": NSNull()]))
    }

    func test译文按协议解析_段落标识和条数有上限() throws {
        let body: [String: Any] = ["type": "deliver", "tabId": "t", "delivery": [
            "run": "r1", "items": [["id": "ab12-3", "text": "译文"]], "failed": ["ab12-4"],
        ]]
        guard case .deliver(_, let delivery) = try TranslateCommand.parse(body) else { return XCTFail("应当是送译文") }
        XCTAssertEqual(delivery.items, [TranslateSegment(id: "ab12-3", text: "译文")])
        XCTAssertEqual(delivery.failed, ["ab12-4"])
        let many = (0...TranslateLimits.deliveryMax).map { ["id": "s\($0)", "text": "x"] }
        XCTAssertThrowsError(try TranslateCommand.parse(["type": "deliver", "tabId": "t",
                                                         "delivery": ["run": "r1", "items": many, "failed": []]]))
        XCTAssertThrowsError(try TranslateCommand.parse(["type": "deliver", "tabId": "t", "delivery": [
            "run": "r1", "items": [["id": "<script>", "text": "x"]], "failed": [] as [String]]]))
    }

    func test脚本消息解析后补上标签转给网页_复制不转() throws {
        let request: [String: Any] = ["type": "request", "run": "r1", "url": "https://a.com/x", "priority": "visible",
                                      "fresh": false, "items": [["id": "n-1", "text": "Hello there"]]]
        let parsed = try TranslatePageMessage.parse(request)
        let event = try XCTUnwrap(parsed.event(tabId: "web:1"))
        XCTAssertEqual(event["tabId"] as? String, "web:1")
        XCTAssertEqual(event["priority"] as? String, "visible")
        XCTAssertEqual((event["items"] as? [[String: Any]])?.first?["text"] as? String, "Hello there")
        let progress = try TranslatePageMessage.parse(["type": "progress", "run": "r1", "pending": 0, "done": 3,
                                                       "failed": 0, "chars": 120, "firstScreenMs": NSNull()])
        XCTAssertTrue(try XCTUnwrap(progress.event(tabId: "t"))["firstScreenMs"] is NSNull)
        XCTAssertNil(try TranslatePageMessage.parse(["type": "copy", "text": "译文"]).event(tabId: "t"))
        let long = String(repeating: "a", count: TranslateLimits.itemChars + 1)
        XCTAssertThrowsError(try TranslatePageMessage.parse(["type": "request", "run": "r1", "url": "https://a.com",
            "priority": "visible", "fresh": false, "items": [["id": "n1", "text": long]]]))
        XCTAssertThrowsError(try TranslatePageMessage.parse(["type": "request", "run": "r1", "url": "https://a.com",
            "priority": "soon", "fresh": false, "items": [["id": "n1", "text": "x"]]]))
        XCTAssertThrowsError(try TranslatePageMessage.parse(["type": "progress", "run": "r1", "pending": -1,
            "done": 0, "failed": 0, "chars": 0]))
    }

    func test付款类页面和有卡号框的页面不翻() {
        XCTAssertTrue(TranslateGate.blocked(url: "https://shop.example.com/checkout", cardFields: false))
        XCTAssertTrue(TranslateGate.blocked(url: "https://www.paypal.com/signin", cardFields: false))
        XCTAssertTrue(TranslateGate.blocked(url: "https://news.example.com/a", cardFields: true))
        XCTAssertFalse(TranslateGate.blocked(url: "https://field-notes.dev/agents/what-to-remember", cardFields: false))
    }

    func test注入的脚本是生成的那一份_走独立脚本世界的通道() {
        let source = TranslatePageScript.source
        XCTAssertTrue(source.hasPrefix("(() => {"))
        XCTAssertTrue(source.contains("installPageTranslator"))
        XCTAssertTrue(source.contains("messageHandlers.plasticineTranslatePage.postMessage"))
        XCTAssertFalse(source.contains("\nimport "))
    }
}
