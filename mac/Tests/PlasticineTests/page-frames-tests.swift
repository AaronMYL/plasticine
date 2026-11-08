import AppKit
import WebKit
import XCTest
@testable import Plasticine

@MainActor
final class PageFramesTests: XCTestCase {
    private func fixture(withoutSecureUUID: Bool = false) async throws -> WKWebView {
        guard let address = ProcessInfo.processInfo.environment["PLASTICINE_FRAME_FIXTURE"],
              let url = URL(string: address) else {
            throw XCTSkip("需启动隔离的本地跨域 fixture，不访问用户页面")
        }
        _ = NSApplication.shared
        let config = WKWebViewConfiguration()
        config.websiteDataStore = .nonPersistent()
        if withoutSecureUUID {
            config.userContentController.addUserScript(WKUserScript(
                source: "Object.defineProperty(crypto, 'randomUUID', { value: undefined });",
                injectionTime: .atDocumentStart, forMainFrameOnly: false, in: .defaultClient))
        }
        PageFrames.shared.install(config.userContentController)
        let view = WKWebView(frame: CGRect(x: 0, y: 0, width: 900, height: 600), configuration: config)
        view.load(URLRequest(url: url))
        for _ in 0..<100 {
            try await Task.sleep(nanoseconds: 100_000_000)
            if !view.isLoading,
               let page = try? await PageOperate.perceive(view),
               case .string(let text) = page["outline"], text.contains("嵌套证据") { return view }
        }
        throw DeviceFailure.failed("隔离 fixture 未就绪")
    }

    private func target(_ page: [String: JSONValue], _ name: String) throws -> Int {
        guard case .array(let elements) = page["elements"] else { throw DeviceFailure.pageStale }
        for case .object(let item) in elements where item["name"] == .string(name) {
            if case .number(let n) = item["n"] { return Int(n) }
        }
        throw DeviceFailure.failed("fixture 缺少目标")
    }

    private func act(_ view: WKWebView, _ page: [String: JSONValue], _ op: String,
                     _ n: Int, allow: Bool = false) async throws -> JSONValue {
        guard case .string(let version) = page["version"] else { throw DeviceFailure.pageStale }
        return try await PageOperate.run(view, ["op": "act", "version": version,
            "act": ["op": op, "n": n], "allowSubmit": allow])
    }

    func test跨域与嵌套读取保持宿主上下文且回车先拦截() async throws {
        let view = try await fixture()
        defer { view.stopLoading() }
        let page = try await PageOperate.perceive(view)
        let n = try target(page, "跨域提问")
        guard case .object(let blocked) = try await act(view, page, "enter", n) else { return XCTFail() }
        XCTAssertEqual(blocked["error"], .string("submit"))
        let read = try await PageFrames.shared.readPage(view, offset: 0)
        guard case .object(let fields) = read, case .string(let text) = fields["text"] else { return XCTFail() }
        XCTAssertTrue(text.contains("嵌套证据"))
        XCTAssertTrue(text.contains("发送次数：0"))
        guard case .object(let sent) = try await act(view, page, "enter", n, allow: true) else { return XCTFail() }
        XCTAssertEqual(sent["ok"], .bool(true))
        let after = try await PageOperate.perceive(view)
        guard case .string(let outline) = after["outline"] else { return XCTFail() }
        XCTAssertTrue(outline.contains("发送次数：1"))
        XCTAssertEqual(view.url?.path, "/host")
    }

    func test移除或导航子框架后旧版本不能提交到另一文档() async throws {
        let view = try await fixture()
        let page = try await PageOperate.perceive(view)
        let n = try target(page, "跨域提问")
        _ = try await view.evaluateJavaScript("document.querySelector('iframe').remove()")
        guard case .object(let done) = try await act(view, page, "enter", n, allow: true) else { return XCTFail() }
        XCTAssertEqual(done["error"], .string("stale"))
    }

    func test站点范围逐框架核验而非只看宿主() async throws {
        let view = try await fixture()
        do {
            _ = try await PageFrames.shared.text(view, ["op": "perceive"], sites: ["not-authorized.invalid"])
            XCTFail("未授权站点不应被读取")
        } catch { XCTAssertTrue(error is DeviceFailure) }
    }
    func test只读跨域与嵌套不操作任何元素() async throws {
        let view = try await fixture()
        let page = try await PageOperate.perceive(view)
        guard case .string(let outline) = page["outline"] else { return XCTFail() }
        XCTAssertTrue(outline.contains("跨域证据"))
        XCTAssertTrue(outline.contains("嵌套证据"))
        XCTAssertTrue(outline.contains("发送次数：0"))
        let read = try await PageFrames.shared.readPage(view, offset: 0)
        guard case .object(let fields) = read, case .string(let text) = fields["text"] else { return XCTFail() }
        XCTAssertTrue(text.contains("嵌套证据"))
        XCTAssertEqual(view.url?.path, "/host")
    }

    func test未审批回车不得派发键盘事件() async throws {
        let view = try await fixture()
        let page = try await PageOperate.perceive(view)
        let n = try target(page, "跨域提问")
        guard case .object(let blocked) = try await act(view, page, "enter", n) else { return XCTFail() }
        XCTAssertEqual(blocked["error"], .string("submit"))
        let after = try await PageOperate.perceive(view)
        guard case .string(let outline) = after["outline"] else { return XCTFail() }
        XCTAssertTrue(outline.contains("发送次数：0"))
    }

    func test后台布局中的编辑器正文不丢失也不混入隐藏文字() async throws {
        let view = try await fixture()
        _ = try await view.evaluateJavaScript("""
            const editor = document.createElement('div');
            editor.contentEditable = 'true'; editor.textContent = '后台编辑器证据';
            document.body.append(editor);
            const hidden = document.createElement('div');
            hidden.hidden = true; hidden.textContent = '不可见证据'; document.body.append(hidden);
            """)
        guard case .object(let read) = try await PageFrames.shared.readPage(view, offset: 0),
              case .string(let text) = read["text"] else { return XCTFail() }
        XCTAssertTrue(text.contains("后台编辑器证据"))
        XCTAssertFalse(text.contains("不可见证据"))
    }

    func test未登记框架明确报无法读取而不是假称完整() async throws {
        let view = try await fixture()
        view.configuration.userContentController.removeAllUserScripts()
        _ = try await view.evaluateJavaScript("""
            const frame = document.createElement('iframe');
            frame.src = '/nested'; document.body.append(frame);
            """)
        try await Task.sleep(nanoseconds: 500_000_000)
        do {
            _ = try await PageOperate.perceive(view)
            XCTFail("未登记框架不应悄悄遗漏")
        } catch {
            XCTAssertTrue(String(describing: error).contains("未登记"))
        }
    }

    func test导航子框架后旧编号失效() async throws {
        let view = try await fixture()
        let page = try await PageOperate.perceive(view)
        let n = try target(page, "跨域提问")
        _ = try await view.evaluateJavaScript("document.querySelector('iframe').src = '/nested'")
        try await Task.sleep(nanoseconds: 500_000_000)
        guard case .object(let result) = try await act(view, page, "enter", n) else { return XCTFail() }
        XCTAssertEqual(result["error"], .string("stale"))
    }

    func test长正文分页能读到末尾且不返回页面脚本() async throws {
        let view = try await fixture()
        _ = try await view.evaluateJavaScript("""
            const editor = document.createElement('div'); editor.contentEditable = 'true';
            editor.textContent = '正文'.repeat(8000) + '全文末尾证据'; document.body.append(editor);
            """)
        var offset = 0
        var text = ""
        for _ in 0..<10 {
            guard case .object(let page) = try await PageFrames.shared.readPage(view, offset: offset),
                  case .string(let part) = page["text"] else { return XCTFail() }
            text += part
            guard case .number(let next) = page["nextOffset"] else { break }
            XCTAssertGreaterThan(Int(next), offset)
            offset = Int(next)
        }
        XCTAssertTrue(text.contains("全文末尾证据"))
        XCTAssertFalse(text.contains("onkeydown"))
    }

    func test没有安全上下文UUID接口仍可登记读取框架() async throws {
        let view = try await fixture(withoutSecureUUID: true)
        let page = try await PageOperate.perceive(view)
        guard case .string(let text) = page["outline"] else { return XCTFail() }
        XCTAssertTrue(text.contains("嵌套证据"))
    }

}
