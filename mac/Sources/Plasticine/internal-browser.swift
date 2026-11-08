import Foundation
import WebKit

/// 同源根文档上的路由属于 Plasticine；附件、API、下载、配对邀请不当成内部页面。
enum InternalPageURL {
    static func hash(_ url: URL, server: URL) -> String? {
        guard ServerAddress.sameOrigin(url, server), ["https", "http"].contains(url.scheme ?? ""),
              let parts = URLComponents(url: url, resolvingAgainstBaseURL: false),
              parts.user == nil, parts.password == nil, parts.query == nil,
              parts.path.isEmpty || parts.path == "/" else { return nil }
        guard let fragment = parts.percentEncodedFragment, !fragment.isEmpty else { return "#/today" }
        guard fragment.hasPrefix("/"), !fragment.contains("?"), !fragment.contains("#") else { return nil }
        return "#" + fragment
    }
}

extension WebWindow {
    /// 用户打开自己的网址回到原模块，入口重复点击不丢详情位置。
    @discardableResult
    func openInternal(_ url: URL) -> Bool {
        guard let hash = InternalPageURL.hash(url, server: settings.server) else { return false }
        emit(["type": "internal", "hash": hash])
        return true
    }
}

extension WebTabs {
    /// AI 的 tab_open / 导航仍保留真实可读、可操作的 WebView。只给本站设置系统 Cookie，不碰外部网站登录。
    func prepareInternalSession(_ url: URL) async throws {
        // 身份按完整源判定，不按前端路由判定：带查询串、index.html、API 和下载也不能沿用导入的用户 Cookie。
        guard let server = owner?.settings.server, ServerAddress.sameOrigin(url, server) else { return }
        guard let credential = try NodeCredentialStore.read(server: server) else {
            throw DeviceFailure.failed("这台 Mac 的节点尚未配对，不能建立内部浏览器会话。")
        }
        let api = NodeHTTP(server: server, credential: credential)
        defer { api.close() }
        let cookie = try await api.browserSessionCookie()
        try Task.checkCancellation()
        await dataStore.httpCookieStore.setCookie(cookie)
    }
}
