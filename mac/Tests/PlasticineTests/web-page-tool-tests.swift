import Foundation
import XCTest
@testable import Plasticine

// 网页工具（第 2 批「浏览器」，web-page-tools.ts）的纯逻辑：消息解析、上限、整页长图缩放、注入脚本带着工具清单。
// 这台机器没有 Xcode，这份写的时候没能跑，等 GitHub macOS 机器上 swift test。
final class WebPageToolTests: XCTestCase {
    private func tool(_ fields: [String: Any]) throws -> WebPageTool {
        guard case .tool(let id, let tool) = try WebTabMessage.parse(["type": "tool", "tabId": "web:1",
                                                                       "tool": fields]) else {
            throw WebTabProtocolError.malformed("应当是工具消息")
        }
        XCTAssertEqual(id, "web:1")
        return tool
    }

    func test工具消息按协议解析_形状不对一律拒() throws {
        XCTAssertEqual(try tool(["kind": "find", "query": "冲突", "backwards": true]),
                       .find(query: "冲突", backwards: true))
        XCTAssertEqual(try tool(["kind": "find_clear"]), .findClear)
        XCTAssertEqual(try tool(["kind": "zoom", "factor": 1.25]), .zoom(1.25))
        XCTAssertEqual(try tool(["kind": "capture", "scope": "full"]), .capture(fullPage: true))
        XCTAssertEqual(try tool(["kind": "capture", "scope": "visible"]), .capture(fullPage: false))
        XCTAssertEqual(try tool(["kind": "circle"]), .circle)
        XCTAssertEqual(try tool(["kind": "circle_cancel"]), .circleCancel)
        XCTAssertEqual(try tool(["kind": "thumbnail"]), .thumbnail)
        XCTAssertEqual(try tool(["kind": "print"]), .print)
        XCTAssertEqual(try tool(["kind": "downloads"]), .downloads)
        XCTAssertEqual(try tool(["kind": "perceive"]), .perceive)
        XCTAssertEqual(try tool(["kind": "extract_images"]), .extractImages)
        XCTAssertEqual(try tool(["kind": "extract_marks", "points": []]),
                       .extractMarks(points: [], focus: nil, color: nil))
        XCTAssertThrowsError(try tool(["kind": "extract_marks", "points": [["quote": "", "context": ""]]]))
        XCTAssertThrowsError(try tool(["kind": "find", "query": ""]))
        XCTAssertThrowsError(try tool(["kind": "find", "query": String(repeating: "字", count: 501)]))
        XCTAssertThrowsError(try tool(["kind": "zoom", "factor": 4]))
        XCTAssertThrowsError(try tool(["kind": "capture", "scope": "region"]))
        XCTAssertThrowsError(try tool(["kind": "eval"]))
        XCTAssertThrowsError(try WebTabMessage.parse(["type": "tool", "tabId": "web:1"]))
    }

    func test整页长图长边超过上限按比例缩小() {
        XCTAssertEqual(WebPageTool.fullPageSize(width: 1200, height: 3000), CGSize(width: 1200, height: 3000))
        XCTAssertEqual(WebPageTool.fullPageSize(width: 1000, height: 32_768), CGSize(width: 500, height: 16_384))
        XCTAssertEqual(WebPageTool.fullPageSize(width: 0, height: 100), .zero)
    }

    func test圈一块的字截到上限() {
        XCTAssertEqual(WebPageTool.clipCircleText(String(repeating: "字", count: 20_001)).count, 20_000)
        XCTAssertEqual(WebPageTool.clipCircleText("一段"), "一段")
    }

    func test注入脚本报会做的工具_工具消息走同一个通道() {
        let source = BridgeScript.source(version: "0.5.0", chrome: WindowChromeState(trafficLightInset: 78,
                                                                                      fullScreen: false))
        XCTAssertTrue(source.contains(#"tools: Object.freeze(["find","zoom","capture","capture_full","print","circle","#
                                      + #""thumbnail","downloads","perceive","extract_images","extract_marks"])"#))
        XCTAssertTrue(source.contains("tool(tabId, tool) { return tabs({ type: 'tool', tabId, tool }); }"))
    }
}
