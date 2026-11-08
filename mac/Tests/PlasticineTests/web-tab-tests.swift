import Foundation
import XCTest
@testable import Plasticine

// 网页标签（第 102 条第 3 批）的纯逻辑：桥接消息、位置换算、正文截断、清单增删、用户在场让路、动作参数和 DOM 判道。
final class WebTabTests: XCTestCase {
    private func params(_ json: String) throws -> ActionParams {
        let decoded = try JSONDecoder().decode(ActionParams.self, from: Data(json.utf8))
        try decoded.validate()
        return decoded
    }

    private func facts(page: String = "https://mail.example.com/inbox", label: String = "归档", name: String = "",
                       autocomplete: String = "", formAction: String = "", isPassword: Bool = false,
                       formHasPassword: Bool = false) -> TabTargetFacts {
        TabTargetFacts(pageUrl: page, label: label, name: name, autocomplete: autocomplete, formAction: formAction,
                       isPassword: isPassword, formHasPassword: formHasPassword)
    }

    func test同步消息按协议解析_形状不对一律拒() throws {
        let body: [String: Any] = ["type": "sync", "state": [
            "tabs": [["tabId": "web:1", "url": "https://example.com/"]], "active": "web:1",
            "frame": ["x": 240, "y": 56, "width": 800, "height": 600],
        ]]
        guard case .sync(let state) = try WebTabMessage.parse(body) else { return XCTFail("应当是同步消息") }
        XCTAssertEqual(state.active, "web:1")
        XCTAssertEqual(state.frame, WebTabFrame(x: 240, y: 56, width: 800, height: 600))
        let empty: [String: Any] = ["tabs": [] as [Any], "active": NSNull(), "frame": NSNull()]
        let hidden: [String: Any] = ["type": "sync", "state": empty]
        guard case .sync(let none) = try WebTabMessage.parse(hidden) else { return XCTFail("应当是同步消息") }
        XCTAssertNil(none.active)
        XCTAssertNil(none.frame)
        XCTAssertThrowsError(try WebTabMessage.parse(["type": "sync"]))
        XCTAssertThrowsError(try WebTabMessage.parse(["type": "eval", "code": "1"]))
        let tooMany = (0...WebTabMessage.maxTabs).map { ["tabId": "t\($0)", "url": "https://a.com/"] }
        XCTAssertThrowsError(try WebTabMessage.parse(["type": "sync", "state": ["tabs": tooMany, "active": NSNull(),
                                                                              "frame": NSNull()]]))
    }

    func test地址栏只开http和https() throws {
        guard case .navigate(_, let url) = try WebTabMessage.parse(["type": "navigate", "tabId": "t1",
                                                                     "url": "https://example.com/a"]) else {
            return XCTFail("应当是换地址")
        }
        XCTAssertEqual(url.host, "example.com")
        for bad in ["javascript:alert(1)", "file:///etc/passwd", "about:blank", "https://"] {
            XCTAssertThrowsError(try WebTabMessage.parse(["type": "navigate", "tabId": "t1", "url": bad]), bad)
        }
        guard case .command(_, .openExternal) = try WebTabMessage.parse(["type": "command", "tabId": "t1",
                                                                         "command": "open_external"]) else {
            return XCTFail("应当是在系统浏览器打开")
        }
    }

    func test中间区换成原生坐标_乘缩放_裁到主网页里() {
        let bounds = CGSize(width: 1200, height: 800)
        let frame = WebTabFrame(x: 240, y: 56, width: 700, height: 744)
        XCTAssertEqual(WebTabGeometry.rect(frame, zoom: 1, bounds: bounds),
                       CGRect(x: 240, y: 56, width: 700, height: 744))
        XCTAssertEqual(WebTabGeometry.rect(frame, zoom: 1.25, bounds: bounds),
                       CGRect(x: 300, y: 70, width: 875, height: 730))
        XCTAssertNil(WebTabGeometry.rect(nil, zoom: 1, bounds: bounds))
        XCTAssertNil(WebTabGeometry.rect(WebTabFrame(x: 0, y: 0, width: 0, height: 0), zoom: 1, bounds: bounds))
        XCTAssertNil(WebTabGeometry.rect(WebTabFrame(x: 2000, y: 0, width: 10, height: 10), zoom: 1, bounds: bounds))
    }

    func test正文超过上限截断并给出总字数() {
        let short = PageText.clip("你好", max: 5)
        XCTAssertEqual(short.text, "你好")
        XCTAssertFalse(short.truncated)
        let long = PageText.clip("一二三四五六七", max: 3)
        XCTAssertEqual(long.text, "一二三")
        XCTAssertEqual(long.total, 7)
        XCTAssertTrue(long.truncated)
        XCTAssertEqual(PageText.maxChars, 100_000)
    }

    func test清单以网页为准_原生自己开还没认领的不关() {
        let sync = WebTabsSync(tabs: [WebTabEntry(tabId: "web:1", url: "https://a.com/"),
                                      WebTabEntry(tabId: "web:3", url: "https://c.com/"),
                                      WebTabEntry(tabId: "web:3", url: "https://c.com/")], active: "web:1", frame: nil)
        let plan = WebTabReconcile.plan(existing: ["web:1": true, "web:2": true, "native:9": false], sync: sync)
        XCTAssertEqual(plan.create, [WebTabEntry(tabId: "web:3", url: "https://c.com/")])
        XCTAssertEqual(plan.remove, ["web:2"])
    }

    func test用户看着这个标签且三十秒内动过键鼠才让路() {
        XCTAssertTrue(WebTabPresence.blocks(viewing: true, idleSeconds: 3))
        XCTAssertFalse(WebTabPresence.blocks(viewing: true, idleSeconds: 30))
        XCTAssertFalse(WebTabPresence.blocks(viewing: false, idleSeconds: 0))
    }

    func test标签动作参数_点要恰好给选择器或字一项() throws {
        let byText = try params(##"{"kind":"tab_click","tabId":"t1","selector":null,"text":"归档"}"##)
        XCTAssertEqual(byText.text, "归档")
        XCTAssertNil(byText.selector)
        XCTAssertEqual(byText.kind.actionClass, "input")
        XCTAssertThrowsError(try params(##"{"kind":"tab_click","tabId":"t1","selector":"#a","text":"归档"}"##))
        XCTAssertThrowsError(try params(##"{"kind":"tab_click","tabId":"t1","selector":null,"text":null}"##))
        XCTAssertThrowsError(try params(##"{"kind":"tab_click","tabId":"t1","text":"归档"}"##))
        let read = try params(##"{"kind":"tab_read","tabId":"t1","offset":12000}"##)
        XCTAssertEqual(read.offset, 12_000)
        XCTAssertEqual(read.kind.actionClass, "browser")
        XCTAssertThrowsError(try params(##"{"kind":"tab_read","tabId":"t1","offset":-1}"##))
        XCTAssertNoThrow(try params(##"{"kind":"tab_fill","tabId":"t1","selector":"#q","value":""}"##))
        XCTAssertThrowsError(try params(##"{"kind":"tab_open","url":"file:///etc/hosts"}"##))
        XCTAssertNoThrow(try params(##"{"kind":"tab_list"}"##))
        XCTAssertTrue(ActionKind.allCases.contains(.tabFill))
    }

    func test问这一页的感知和按编号操作_参数给齐才收() throws {
        let perceive = try params(##"{"kind":"tab_perceive","tabId":"t1"}"##)
        XCTAssertEqual(perceive.kind.actionClass, "browser")
        let click = try params(##"{"kind":"tab_act","tabId":"t1","version":"v1","act":{"op":"click","n":8},"##
            + ##""step":"点提交","submitAsk":null}"##)
        XCTAssertEqual(click.act, PageActParams(op: "click", n: 8, value: nil, dy: nil))
        XCTAssertEqual(click.kind.actionClass, "input")
        XCTAssertNil(click.submitAsk)
        XCTAssertNoThrow(try params(##"{"kind":"tab_act","tabId":"t1","version":"v1","act":{"op":"fill","n":2,"##
            + ##""value":"Alex"},"step":"填姓名","submitAsk":null}"##))
        XCTAssertNoThrow(try params(##"{"kind":"tab_act","tabId":"t1","version":"v1","act":{"op":"scroll","dy":600},"##
            + ##""step":"往下翻","submitAsk":null}"##))
        XCTAssertNoThrow(try params(##"{"kind":"tab_act","tabId":"t1","version":"v1","act":{"op":"click","n":8},"##
            + ##""step":"点提交","submitAsk":"ask-1"}"##))
        XCTAssertThrowsError(try params(##"{"kind":"tab_act","tabId":"t1","version":"v1","act":{"op":"fill","n":2},"##
            + ##""step":"填姓名","submitAsk":null}"##), "填要给值")
        XCTAssertThrowsError(try params(##"{"kind":"tab_act","tabId":"t1","version":"v1","act":{"op":"fill","n":2,"##
            + ##""value":"x"},"step":"填","submitAsk":"ask-1"}"##), "放行提交只给点和回车")
        XCTAssertThrowsError(try params(##"{"kind":"tab_act","tabId":"t1","version":"v1","act":{"op":"eval","n":1},"##
            + ##""step":"跑脚本","submitAsk":null}"##))
        XCTAssertThrowsError(try params(##"{"kind":"tab_act","tabId":"t1","version":"v1","act":{"op":"click","n":8},"##
            + ##""step":"点提交"}"##), "submitAsk 这一项要在（平时是 null）")
    }

    func test按编号操作不在设备侧关死提交_像卡号的字照旧关死() throws {
        let pay = try params(##"{"kind":"tab_act","tabId":"t1","version":"v1","act":{"op":"click","n":8},"##
            + ##""step":"点「提交报名并支付」","submitAsk":null}"##)
        XCTAssertEqual(DeviceLanePolicy.classify(pay, inSettingsApp: false), .allow)
        let card = try params(##"{"kind":"tab_act","tabId":"t1","version":"v1","act":{"op":"fill","n":5,"##
            + ##""value":"4111 1111 1111 1111"},"step":"填卡号","submitAsk":null}"##)
        XCTAssertEqual(DeviceLanePolicy.classify(card, inSettingsApp: false), .deny)
        XCTAssertEqual(ActionReport.submitHeld(.object([:])).errorCode, "submit_needs_you")
        XCTAssertEqual(ActionReport.pageStale().errorCode, "page_stale")
    }

    func test标签动作按参数判道_付款关死_密码框要你点() throws {
        let pay = try params(##"{"kind":"tab_open","url":"https://cashier.alipay.com/standard"}"##)
        XCTAssertEqual(DeviceLanePolicy.classify(pay, inSettingsApp: false), .deny)
        let order = try params(##"{"kind":"tab_click","tabId":"t1","selector":"button#place-order","text":null}"##)
        XCTAssertEqual(DeviceLanePolicy.classify(order, inSettingsApp: false), .deny)
        let card = try params(##"{"kind":"tab_fill","tabId":"t1","selector":"#n","value":"4111 1111 1111 1111"}"##)
        XCTAssertEqual(DeviceLanePolicy.classify(card, inSettingsApp: false), .deny)
        let password = try params(##"{"kind":"tab_fill","tabId":"t1","selector":"input[type=password]","value":"x"}"##)
        XCTAssertEqual(DeviceLanePolicy.classify(password, inSettingsApp: false), .confirm)
        let next = try params(##"{"kind":"tab_click","tabId":"t1","selector":null,"text":"下一页"}"##)
        XCTAssertEqual(DeviceLanePolicy.classify(next, inSettingsApp: false), .allow)
    }

    func test按真实DOM再判一次_付款页面和按钮关死_带密码框的表单要你点() {
        XCTAssertEqual(DeviceLanePolicy.classifyTarget(facts(), kind: .tabClick, value: nil), .allow)
        XCTAssertEqual(DeviceLanePolicy.classifyTarget(facts(label: "立即支付"), kind: .tabClick, value: nil), .deny)
        XCTAssertEqual(DeviceLanePolicy.classifyTarget(facts(label: "Place order"), kind: .tabClick, value: nil), .deny)
        XCTAssertEqual(DeviceLanePolicy.classifyTarget(facts(page: "https://shop.example.com/checkout"),
                                                       kind: .tabClick, value: nil), .deny)
        XCTAssertEqual(DeviceLanePolicy.classifyTarget(facts(formAction: "https://pay.example.com/pay"),
                                                       kind: .tabClick, value: nil), .deny)
        XCTAssertEqual(DeviceLanePolicy.classifyTarget(facts(label: "登录", formHasPassword: true),
                                                       kind: .tabClick, value: nil), .confirm)
        XCTAssertEqual(DeviceLanePolicy.classifyTarget(facts(label: "", isPassword: true), kind: .tabFill, value: "x"),
                       .confirm)
        XCTAssertEqual(DeviceLanePolicy.classifyTarget(facts(autocomplete: "cc-number"), kind: .tabFill, value: "1"),
                       .deny)
        XCTAssertEqual(DeviceLanePolicy.classifyTarget(facts(name: "q"), kind: .tabFill, value: "4111111111111111"),
                       .deny)
        XCTAssertEqual(DeviceLanePolicy.classifyTarget(facts(name: "q"), kind: .tabFill, value: "杭州 天气"), .allow)
    }

    func test用户在场的回执带让路的失败种类() throws {
        let report = ActionReport.present()
        XCTAssertEqual(report.status, "failed")
        XCTAssertEqual(report.errorCode, "user_present")
    }
}
