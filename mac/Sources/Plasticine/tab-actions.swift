import AppKit
import WebKit

// 网页标签的设备动作（第 102 条第 3 批，Plasticine 的「手」）：列、读、开、换地址、点、填，都按 DOM 做，不动真鼠标。
// 点和填之前：用户正看着这个标签就让路（user_present）；找到元素后按它的真实 DOM 再判一次道（device-lane.swift），
// 付款类关死、密码框和带密码框的表单要你点。回执带完成证明：开 / 换地址读回载入完成，点读回页面前后状态，填读回值。

struct TabActionContext {
    /// 用户在设备上签名放开过付款类（payments = confirm_each）：关死降为弹一次确认。
    let paymentsOpen: Bool
    /// 这一步已经在设备上弹过确认、用户点了允许：DOM 判道不再重复问。
    let confirmed: Bool

    let sites: [String]
    init(paymentsOpen: Bool, confirmed: Bool, sites: [String] = []) {
        self.paymentsOpen = paymentsOpen
        self.confirmed = confirmed
        self.sites = sites
    }
    static let unconfirmed = TabActionContext(paymentsOpen: false, confirmed: false)
}

@MainActor
final class TabActions {
    weak var tabs: WebTabs?
    // 载入最多等这么久；超时照样回执（loaded: false），不算证明。
    private static let openSeconds = 30.0
    private static let settleAfterClick: UInt64 = 600_000_000
    private static let clickLoadSeconds = 10.0

    func execute(_ params: ActionParams, context: TabActionContext) async throws -> JSONValue {
        guard let tabs else { throw DeviceFailure.failed("Plasticine 窗口还没准备好网页标签，请打开窗口后再试。") }
        // 复用已打开的自站页面时也恢复系统身份；导入登录后的点、填、读取不能借残留用户 Cookie 冒名。
        if let id = params.tabId, let url = try requireTab(tabs, id).view.url {
            try await tabs.prepareInternalSession(url)
        }
        switch params.kind {
        case .tabList: return list(tabs)
        case .tabRead:
            let read = try await PageFrames.shared.readPage(try requireTab(tabs, params.tabId).view, offset: params.offset ?? 0, sites: context.sites)
            guard case .object(var fields) = read else { throw DeviceFailure.failed("网页回的结果格式不对，请重试。") }
            fields["tabId"] = .string(params.tabId!)
            return .object(fields)
        case .tabOpen:
            let opened = tabs.open(URL(string: params.url!)!)
            let loaded = await opened.waitForLoad(seconds: TabActions.openSeconds)
            return page(opened, loaded: loaded)
        case .tabNavigate:
            let target = try requireTab(tabs, params.tabId)
            target.automating += 1
            defer { target.automating -= 1 }
            target.view.load(URLRequest(url: URL(string: params.url!)!))
            let loaded = await target.waitForLoad(seconds: TabActions.openSeconds)
            return page(target, loaded: loaded)
        case .tabClick: return try await click(tabs, params, context: context)
        case .tabFill: return try await fill(tabs, params, context: context)
        // 第 3 批「问这一页 → 操作整页」（page-operate.swift）：不让路，光点和步骤让他看得到；提交由脚本拦下等他定。
        case .tabPerceive: return try await perceiveTab(try requireTab(tabs, params.tabId), sites: context.sites)
        case .tabAct: return try await operate(try requireTab(tabs, params.tabId), params, sites: context.sites)
        default: throw DeviceFailure.refused("这不是网页标签动作")
        }
    }

    func requireTab(_ tabs: WebTabs, _ id: String?) throws -> WebTab {
        guard let id, let tab = tabs.tab(id) else {
            throw DeviceFailure.failed("没有这个网页标签（可能已经关了）；先用 tab_list 看开着哪些。")
        }
        return tab
    }

    private func list(_ tabs: WebTabs) -> JSONValue {
        let items = tabs.ordered.map { tab -> JSONValue in
            .object(["tabId": .string(tab.id), "url": .string(tab.view.url?.absoluteString ?? ""),
                     "title": .string(tab.view.title ?? ""), "active": .bool(tab.id == tabs.activeID),
                     "loading": .bool(tab.view.isLoading)])
        }
        return .object(["tabs": .array(items), "viewing": tabs.viewingID.map(JSONValue.string) ?? .null])
    }

    private func page(_ tab: WebTab, loaded: Bool) -> JSONValue {
        .object(["tabId": .string(tab.id), "url": .string(tab.view.url?.absoluteString ?? ""),
                 "title": .string(tab.view.title ?? ""), "loaded": .bool(loaded)])
    }

    /// 用户正看着这个标签、刚动过键鼠：不和用户抢（服务端让任务等用户停下来）。刚在设备上点过允许的不算抢。
    private func yieldToViewer(_ tabs: WebTabs, _ id: String, context: TabActionContext) throws {
        let viewing = tabs.viewingID == id
        if !context.confirmed, WebTabPresence.blocks(viewing: viewing, idleSeconds: Permissions.idleSeconds) {
            throw DeviceFailure.present
        }
    }

    private func gate(_ lane: DeviceLane, context: TabActionContext, action: String, host: String) async throws {
        switch lane {
        case .allow: return
        case .deny:
            guard context.paymentsOpen else {
                throw DeviceFailure.refused("按页面上的实际内容，这一步像付款、下单或转账：设备上一律不做（关死）。")
            }
        case .confirm: break
        }
        if context.confirmed { return }
        let detail = lane == .deny ? "按页面上的实际内容，这一步像付款、下单或转账。确认后才做。"
            : "要操作的是密码框，或带密码框的表单（登录、改密码）。确认后才做。"
        let allowed = await NativePrompts.confirm("Plasticine 要在网页标签（\(host)）里\(action)", detail: detail)
        try Task.checkCancellation()
        guard allowed else { throw DeviceFailure.refused("用户未允许这次动作") }
    }

    private func locate(_ tab: WebTab, _ params: ActionParams, nonce: String) async throws -> TabLocateResult {
        let target = try await WebTabDOM.locateTarget(tab.view, selector: params.selector, text: params.selector == nil
            ? params.text : nil, nonce: nonce)
        guard target.found, target.facts != nil else {
            if target.error == "selector" { throw DeviceFailure.failed("选择器写得不对，页面认不出来；换一个选择器再试。") }
            let what = params.selector.map { "选择器「\($0)」" } ?? "写着「\(params.text ?? "")」的可点元素"
            throw DeviceFailure.failed("页面上找不到\(what)；先用 tab_read 看看页面上有什么。")
        }
        return target
    }

    private func click(_ tabs: WebTabs, _ params: ActionParams, context: TabActionContext) async throws -> JSONValue {
        let tab: WebTab = try requireTab(tabs, params.tabId)
        try yieldToViewer(tabs, tab.id, context: context)
        let nonce = UUID().uuidString
        let target = try await locate(tab, params, nonce: nonce)
        let lane = DeviceLanePolicy.classifyTarget(target.facts!, kind: .tabClick, value: nil)
        try await gate(lane, context: context, action: "点「\(target.text ?? "")」", host: host(tab))
        let before = try await WebTabDOM.readState(tab.view, nonce: nonce, cleanup: false)
        tab.automating += 1
        defer { tab.automating -= 1 }
        guard try await WebTabDOM.clickTarget(tab.view, nonce: nonce) else {
            throw DeviceFailure.failed("要点的元素在点之前不见了（页面刚变过）；重新读一下页面再点。")
        }
        try await Task.sleep(nanoseconds: TabActions.settleAfterClick)
        if tab.view.isLoading { _ = await tab.waitForLoad(seconds: TabActions.clickLoadSeconds) }
        let after = try await WebTabDOM.readState(tab.view, nonce: nonce, cleanup: true)
        let beforeDigest = Digest.hex(Data(before.state.utf8))
        let afterDigest = Digest.hex(Data(after.state.utf8))
        return .object([
            "tabId": .string(tab.id),
            "target": .object(["tag": .string(target.tag ?? ""), "text": .string(target.text ?? "")]),
            "before": .object(["url": .string(before.url), "title": .string(before.title),
                               "digest": .string(beforeDigest)]),
            "after": .object(["url": .string(after.url), "title": .string(after.title),
                              "digest": .string(afterDigest)]),
            "changed": .bool(beforeDigest != afterDigest),
        ])
    }

    private func fill(_ tabs: WebTabs, _ params: ActionParams, context: TabActionContext) async throws -> JSONValue {
        let tab: WebTab = try requireTab(tabs, params.tabId)
        try yieldToViewer(tabs, tab.id, context: context)
        let nonce = UUID().uuidString
        let target = try await locate(tab, params, nonce: nonce)
        let lane = DeviceLanePolicy.classifyTarget(target.facts!, kind: .tabFill, value: params.value)
        try await gate(lane, context: context, action: "填「\(params.selector ?? "")」", host: host(tab))
        tab.automating += 1
        defer { tab.automating -= 1 }
        let filled = try await WebTabDOM.fillTarget(tab.view, nonce: nonce, value: params.value ?? "")
        guard filled.ok else {
            switch filled.error {
            case "disabled": throw DeviceFailure.failed("这个框现在不能填（禁用或只读）。")
            case "option": throw DeviceFailure.failed("下拉框里没有「\(params.value ?? "")」这一项；先读一下有哪些选项。")
            case "unfillable": throw DeviceFailure.failed("选中的元素不是输入框、下拉框或可编辑区域，填不进去。")
            default: throw DeviceFailure.failed("要填的框在填之前不见了（页面刚变过）；重新读一下页面再填。")
            }
        }
        return .object(["tabId": .string(tab.id), "selector": .string(params.selector ?? ""),
                        "tag": .string(filled.tag ?? ""), "type": .string(filled.type ?? ""),
                        "matches": .bool(filled.matches ?? false)])
    }

    private func host(_ tab: WebTab) -> String { tab.view.url?.host ?? "网页" }
}
