import AppKit
import WebKit

extension WebWindow: WKNavigationDelegate, WKUIDelegate {

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
        if action.targetFrame == nil {
            outside(url)
            decisionHandler(.cancel)
            return
        }
        let local = ServerAddress.sameOrigin(url, settings.server)
        let blob = url.scheme == "blob" && url.absoluteString.hasPrefix("blob:" + settings.server.absoluteString)
        if action.targetFrame?.isMainFrame == true, !local, !blob, url.absoluteString != "about:blank" {
            outside(url)
            decisionHandler(.cancel)
            return
        }
        decisionHandler(action.shouldPerformDownload ? .download : .allow)
    }

    func webView(
        _ webView: WKWebView, decidePolicyFor response: WKNavigationResponse,
        decisionHandler: @escaping (WKNavigationResponsePolicy) -> Void
    ) {
        decisionHandler(response.canShowMIMEType ? .allow : .download)
    }

    func webView(_ webView: WKWebView, navigationAction: WKNavigationAction, didBecome download: WKDownload) {
        downloads.receive(download)
    }

    func webView(_ webView: WKWebView, navigationResponse: WKNavigationResponse, didBecome download: WKDownload) {
        downloads.receive(download)
    }

    func webView(_ webView: WKWebView, didStartProvisionalNavigation navigation: WKNavigation!) { loaded = false }

    // 换了一份文档：上一份报的顶栏布局作废，等新页面再报（窗口外观本身不换回去）。
    func webView(_ webView: WKWebView, didCommit navigation: WKNavigation!) { chrome.documentChanged() }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        loaded = true
        let queued = pending
        pending.removeAll()
        for (name, arguments) in queued { invoke(name, arguments: arguments) }
        if let hash = pendingHash {
            pendingHash = nil
            navigate(hash: hash)
        }
        tabs.reannounce()
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        if (error as NSError).code == NSURLErrorCancelled { return }
        NativePrompts.show("页面连接失败，请检查网络、服务器地址和 HTTPS 证书，再按 ⌘R 重新载入。")
    }

    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) { webView.reload() }

    func webView(
        _ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration,
        for navigationAction: WKNavigationAction, windowFeatures: WKWindowFeatures
    ) -> WKWebView? {
        if let url = navigationAction.request.url { outside(url) }
        return nil
    }

    /// Plasticine 自己的页面要去站外（0.2.1 起）：http(s) 开成 Plasticine 的网页标签（经 webTabs 事件通道交给网页界面
    /// 认领并切过去）；mailto:、tel: 这类照旧交给系统。网页界面自己已经拦了站外链接的点击，这里接住漏网的
    /// （window.open、表单提交、脚本跳转）。
    private func outside(_ url: URL) {
        let scheme = url.scheme?.lowercased() ?? ""
        if scheme == "https" || scheme == "http" {
            tabs.openForUser(url)
        } else {
            external(url)
        }
    }

    func webView(
        _ webView: WKWebView, runOpenPanelWith parameters: WKOpenPanelParameters,
        initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping ([URL]?) -> Void
    ) {
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
        let alert = NSAlert()
        alert.messageText = message
        alert.beginSheetModal(for: window) { _ in completionHandler() }
    }

    func webView(
        _ webView: WKWebView, runJavaScriptConfirmPanelWithMessage message: String,
        initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (Bool) -> Void
    ) {
        let alert = NSAlert()
        alert.messageText = message
        alert.addButton(withTitle: "确定")
        alert.addButton(withTitle: "取消")
        alert.beginSheetModal(for: window) { completionHandler($0 == .alertFirstButtonReturn) }
    }

    func webView(
        _ webView: WKWebView, runJavaScriptTextInputPanelWithPrompt prompt: String, defaultText: String?,
        initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (String?) -> Void
    ) {
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
