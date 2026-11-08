import Foundation
import WebKit

// 「问这一页 → 感知并操作整页」（2026-11-04 第 3 批）的 Mac 一侧，脚本是 page-operate-script.swift（抄自
// client/src/mac/page-operate.ts）。三处用它：
// - 网页界面的「问这一页」：webTabs.tool(tabId, { kind: 'perceive' })，回页面结构（web-page-tools.swift）。
// - 设备动作 tab_perceive：同一份结构，加上 tabId。
// - 设备动作 tab_act：按编号做一下。做之前报一步「在做」给网页界面（对话框里列出来），页面上蓝灰光点移到那个元素上；
//   提交没放行脚本不点，报「要提交了」、回 submit_needs_you；编号过期回 page_stale；做完等页面稳定再感知一次，
//   回执带前后页面和做完的样子。
// 脚本都在网页标签的独立脚本世界（.defaultClient）里跑，编号存在那个世界里，「问这一页」和 tab_act 共用。
// 用户正看着这个标签时不让路（不同于 tab_click / tab_fill）：这是他让 Plasticine 在这一页上做，光点和步骤让他看得到。
// 注意：这台机器没有 Xcode，这份第 3 批写的时候没能编译，等 GitHub macOS 机器上跑 swift build / swift test 和真 App。

enum PageOperate {
    /// 点之后等页面动一下再读回（和 tab_click 一样 0.6 秒）；还在载入就再等载入完，最多 10 秒。
    static let settleNanoseconds: UInt64 = 600_000_000
    static let loadSeconds = 10.0

    /// 跑一次脚本，回它那段 JSON 字符串（网页界面的「问这一页」原样交给网页侧校验）。
    @MainActor
    static func text(_ view: WKWebView, _ request: [String: Any], sites: [String] = []) async throws -> String {
        try await PageFrames.shared.text(view, request, sites: sites)
    }

    /// 跑一次脚本，回它那段 JSON 解出来的值。
    @MainActor
    static func run(_ view: WKWebView, _ request: [String: Any], sites: [String] = []) async throws -> JSONValue {
        guard let data = try await text(view, request, sites: sites).data(using: .utf8) else {
            throw DeviceFailure.failed("页面回的结果格式不对，重新感知一下再做。")
        }
        do {
            return try JSONDecoder().decode(JSONValue.self, from: data)
        } catch {
            throw DeviceFailure.failed("页面回的结果格式不对，重新感知一下再做。")
        }
    }

    @MainActor
    static func perceive(_ view: WKWebView, sites: [String] = []) async throws -> [String: JSONValue] {
        guard case .object(let fields) = try await run(view, ["op": "perceive"], sites: sites) else {
            throw DeviceFailure.failed("页面结构没读出来，请重试。")
        }
        return fields
    }

    static func state(_ page: [String: JSONValue]) -> JSONValue {
        .object(["url": page["url"] ?? .string(""), "title": page["title"] ?? .string(""),
                 "digest": page["digest"] ?? .string("")])
    }

    /// 脚本没做成时的一句（提交、过期另有分类）。
    static func failure(_ code: String) -> String {
        switch code {
        case "password": return "密码框不由 Plasticine 填：请你自己填，或用钥匙串里存的密码。"
        case "card": return "银行卡号、安全码这类不由 Plasticine 填。"
        case "disabled": return "这个元素现在不能用（禁用或只读）。"
        case "option": return "下拉框里没有这一项；先重新感知看看有哪些选项。"
        case "unfillable": return "这个元素不是输入框或下拉框，填不进去。"
        default: return "网页上这一下没做成，重新感知一下再试。"
        }
    }
}

@MainActor
extension TabActions {
    func perceiveTab(_ tab: WebTab, sites: [String] = []) async throws -> JSONValue {
        var fields = try await PageOperate.perceive(tab.view, sites: sites)
        fields["tabId"] = .string(tab.id)
        return .object(fields)
    }

    func operate(_ tab: WebTab, _ params: ActionParams, sites: [String] = []) async throws -> JSONValue {
        guard let act = params.act, let version = params.version, let step = params.step else {
            throw DeviceFailure.refused("网页操作参数不全")
        }
        guard tabs?.viewingID != tab.id else { throw DeviceFailure.present }
        let stepID = UUID().uuidString
        let window = tabs?.owner
        let report = { (status: String, text: String) in
            window?.emit(["type": "operate", "tabId": tab.id, "actionId": stepID, "status": status, "step": text])
        }
        report("run", step)
        let before = try await PageOperate.perceive(tab.view, sites: sites)
        tab.automating += 1
        defer { tab.automating -= 1 }
        let request: [String: Any] = ["op": "act", "version": version, "act": act.script,
                                      "allowSubmit": params.submitAsk != nil]
        guard case .object(let done) = try await PageOperate.run(tab.view, request, sites: sites) else {
            report("err", step)
            throw DeviceFailure.failed(PageOperate.failure(""))
        }
        if done["ok"] != .bool(true) {
            let code: String
            if case .string(let value) = done["error"] { code = value } else { code = "" }
            switch code {
            case "submit":
                report("wait", "要提交了，等你定")
                throw DeviceFailure.submitHeld(.object(["submit": done["submit"] ?? .null,
                                                        "target": done["target"] ?? .null]))
            case "stale":
                report("err", "页面变了，重新看一遍")
                throw DeviceFailure.pageStale
            default:
                report("err", step)
                throw DeviceFailure.failed(PageOperate.failure(code))
            }
        }
        if act.op == "click" || act.op == "enter" {
            try await Task.sleep(nanoseconds: PageOperate.settleNanoseconds)
            if tab.view.isLoading { _ = await tab.waitForLoad(seconds: PageOperate.loadSeconds) }
        }
        let after = try await PageOperate.perceive(tab.view, sites: sites)
        report("done", step)
        let matches: JSONValue
        if case .bool(let value) = done["matches"] { matches = .bool(value) } else { matches = .null }
        return .object([
            "tabId": .string(tab.id),
            "op": .string(act.op),
            "target": done["target"] ?? .null,
            "before": PageOperate.state(before),
            "after": PageOperate.state(after),
            "changed": .bool(before["digest"] != after["digest"] || before["url"] != after["url"]),
            "matches": matches,
            "submitted": done["submitted"] ?? .null,
            "page": .object(after),
        ])
    }
}
