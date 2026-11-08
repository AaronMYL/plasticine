import AppKit
import WebKit

// 网页标签的导航和界面代理：新窗口、target=_blank 开成新标签；下载沿用主窗口的下载逻辑（存到「下载」，同名加后缀）；
// http(s) 以外的链接（mailto:、tel:）交给系统，Plasticine 正在点 / 填时一律不跳出去；网页自己 window.close() 就关标签。

@MainActor
final class WebTabDelegate: NSObject, WKNavigationDelegate, WKUIDelegate {
    private weak var tabs: WebTabs?
    // 留在网页标签里打开的协议；其余的交给系统（WebWindow.external 只放 http、https、mailto、tel）。
    private static let inPage: Set<String> = ["http", "https", "about", "blob", "data"]

    init(tabs: WebTabs) { self.tabs = tabs }

    // WebKit 的 WebCrypto 主密钥交我们自己的，不让 WebKit 去钥匙串里取（见 web-crypto-master-key.swift）。
    @objc(_webCryptoMasterKeyForWebView:)
    func webCryptoMasterKey(forWebView webView: WKWebView) -> Data? { WebCryptoMasterKey.data() }

    @objc(_webCryptoMasterKeyForWebView:completionHandler:)
    func webCryptoMasterKey(forWebView webView: WKWebView, completionHandler: @escaping (Data?) -> Void) {
        completionHandler(WebCryptoMasterKey.data())
    }


    func webView(
        _ webView: WKWebView, decidePolicyFor action: WKNavigationAction,
        decisionHandler: @escaping (WKNavigationActionPolicy) -> Void
    ) {
        guard let url = action.request.url else {
            decisionHandler(.cancel)
            return
        }
        if let tabs, let server = tabs.owner?.settings.server, ServerAddress.sameOrigin(url, server) {
            let tab = tabs.tab(for: webView)
            if tab?.openedBy == "plasticine" || (tab?.automating ?? 0) > 0 {
                Task { @MainActor in
                    do {
                        try await tabs.prepareInternalSession(url)
                        decisionHandler(action.shouldPerformDownload ? .download : .allow)
                    } catch {
                        decisionHandler(.cancel)
                        tab?.loadEnded(false)
                    }
                }
                return
            } else if action.targetFrame?.isMainFrame == true, !action.shouldPerformDownload,
                      tabs.owner?.openInternal(url) == true {
                decisionHandler(.cancel)
                return
            }
        }
        if WebTabDelegate.inPage.contains(url.scheme?.lowercased() ?? "") {
            decisionHandler(action.shouldPerformDownload ? .download : .allow)
            return
        }
        if let tab = tabs?.tab(for: webView), tab.automating == 0 { tabs?.owner?.external(url) }
        decisionHandler(.cancel)
    }

    func webView(
        _ webView: WKWebView, decidePolicyFor response: WKNavigationResponse,
        decisionHandler: @escaping (WKNavigationResponsePolicy) -> Void
    ) {
        decisionHandler(response.canShowMIMEType ? .allow : .download)
    }

    func webView(_ webView: WKWebView, navigationAction: WKNavigationAction, didBecome download: WKDownload) {
        tabs?.owner?.downloads.receive(download)
    }

    func webView(_ webView: WKWebView, navigationResponse: WKNavigationResponse, didBecome download: WKDownload) {
        tabs?.owner?.downloads.receive(download)
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        tabs?.tab(for: webView)?.loadEnded(true)
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        tabs?.tab(for: webView)?.loadEnded(false)
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        // 被新的导航顶掉（用户又点了别处）不算失败，那一次载入还会结束。
        if (error as NSError).code == NSURLErrorCancelled { return }
        tabs?.tab(for: webView)?.loadEnded(false)
    }

    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) { webView.reload() }

    func webView(
        _ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration,
        for navigationAction: WKNavigationAction, windowFeatures: WKWindowFeatures
    ) -> WKWebView? {
        let url = navigationAction.request.url
        if let url, !WebTabDelegate.inPage.contains(url.scheme?.lowercased() ?? "") {
            tabs?.owner?.external(url)
            return nil
        }
        let origin = tabs?.tab(for: webView)
        let automated = origin?.openedBy == "plasticine" || (origin?.automating ?? 0) > 0
        if !automated, let url, tabs?.owner?.openInternal(url) == true { return nil }
        return tabs?.adoptWindow(configuration: configuration, url: url, openedBy: automated ? "plasticine" : "user")
    }

    func webViewDidClose(_ webView: WKWebView) { tabs?.closedByPage(webView) }

    func webView(
        _ webView: WKWebView, runOpenPanelWith parameters: WKOpenPanelParameters,
        initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping ([URL]?) -> Void
    ) {
        guard let window = tabs?.owner?.window else {
            completionHandler(nil)
            return
        }
        let panel = NSOpenPanel()
        panel.allowsMultipleSelection = parameters.allowsMultipleSelection
        panel.canChooseDirectories = parameters.allowsDirectories
        panel.canChooseFiles = true
        panel.beginSheetModal(for: window) { response in
            completionHandler(response == .OK ? panel.urls : nil)
        }
    }

    func webView(
        _ webView: WKWebView, runJavaScriptAlertPanelWithMessage message: String,
        initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping () -> Void
    ) {
        guard let window = tabs?.owner?.window else {
            completionHandler()
            return
        }
        let alert = NSAlert()
        alert.messageText = frame.request.url?.host ?? "网页"
        alert.informativeText = message
        alert.beginSheetModal(for: window) { _ in completionHandler() }
    }

    func webView(
        _ webView: WKWebView, runJavaScriptConfirmPanelWithMessage message: String,
        initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (Bool) -> Void
    ) {
        guard let window = tabs?.owner?.window else {
            completionHandler(false)
            return
        }
        let alert = NSAlert()
        alert.messageText = frame.request.url?.host ?? "网页"
        alert.informativeText = message
        alert.addButton(withTitle: "确定")
        alert.addButton(withTitle: "取消")
        alert.beginSheetModal(for: window) { completionHandler($0 == .alertFirstButtonReturn) }
    }

    func webView(
        _ webView: WKWebView, runJavaScriptTextInputPanelWithPrompt prompt: String, defaultText: String?,
        initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (String?) -> Void
    ) {
        guard let window = tabs?.owner?.window else {
            completionHandler(nil)
            return
        }
        let alert = NSAlert()
        alert.messageText = prompt
        let input = NSTextField(string: defaultText ?? "")
        input.frame = NSRect(x: 0, y: 0, width: 320, height: 24)
        alert.accessoryView = input
        alert.addButton(withTitle: "确定")
        alert.addButton(withTitle: "取消")
        alert.beginSheetModal(for: window) { response in
            completionHandler(response == .alertFirstButtonReturn ? input.stringValue : nil)
        }
    }
}
