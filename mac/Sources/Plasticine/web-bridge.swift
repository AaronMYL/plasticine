import WebKit

@MainActor
final class WebBridge: NSObject, WKScriptMessageHandler {
    weak var owner: WebWindow?
    weak var notifications: NotificationManager?

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard let owner, message.frameInfo.isMainFrame,
              let url = message.frameInfo.request.url, ServerAddress.sameOrigin(url, owner.settings.server),
              let body = message.body as? [String: Any], let title = body["title"] as? String,
              let text = body["body"] as? String, let hash = body["hash"] as? String else { return }
        Task {
            await notifications?.send(title: String(title.prefix(200)), body: String(text.prefix(4000)), hash: hash)
        }
    }
}

// 网页标签的消息通道（第 102 条第 3 批，协议见 agent/shared/api/mac-bridge.ts）：只收 Plasticine 主网页本站主 frame 的
// 消息；网页标签里的页面用的是另一套配置，根本没有这个通道。
@MainActor
final class WebTabsBridge: NSObject, WKScriptMessageHandlerWithReply {
    weak var owner: WebWindow?

    func userContentController(
        _ userContentController: WKUserContentController, didReceive message: WKScriptMessage,
        replyHandler: @escaping (Any?, String?) -> Void
    ) {
        guard let owner, message.webView === owner.webView, message.frameInfo.isMainFrame,
              let url = message.frameInfo.request.url, ServerAddress.sameOrigin(url, owner.settings.server) else {
            replyHandler(nil, "只接受 Plasticine 主页面的消息")
            return
        }
        let parsed: WebTabMessage
        do { parsed = try WebTabMessage.parse(message.body) } catch {
            replyHandler(nil, "网页标签消息格式不对")
            return
        }
        switch parsed {
        case .sync(let state):
            owner.tabs.apply(state)
            replyHandler(true, nil)
        case .command(let id, let command):
            owner.tabs.command(id, command)
            replyHandler(true, nil)
        case .navigate(let id, let address):
            owner.tabs.navigate(id, address)
            replyHandler(true, nil)
        case .snapshot(let id):
            Task {
                do { replyHandler(try await owner.tabs.snapshot(id), nil) } catch {
                    replyHandler(nil, error.localizedDescription)
                }
            }
        case .tool(let id, let tool):
            Task {
                do { replyHandler(try await owner.tabs.perform(id, tool), nil) } catch {
                    replyHandler(nil, error.localizedDescription)
                }
            }
        }
    }
}

// 窗口外观的消息通道（0.3.0，协议见 agent/shared/api/mac-bridge.ts 的 TitlebarLayout）：网页报顶栏多高、哪些矩形是
// 按钮和标签（不拖窗口）。同样只收 Plasticine 主页面本站主 frame 的消息；不要回执。
@MainActor
final class WindowChromeBridge: NSObject, WKScriptMessageHandler {
    weak var owner: WebWindow?

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard let owner, message.webView === owner.webView, message.frameInfo.isMainFrame,
              let url = message.frameInfo.request.url, ServerAddress.sameOrigin(url, owner.settings.server) else {
            return
        }
        do {
            owner.applyTitlebar(try WindowChromeMessage.parse(message.body))
        } catch {
            // 网页发错了形状：不猜，留着上一份布局，记一笔方便对照协议。
            NSLog("Plasticine：顶栏布局消息不对：%@", String(describing: error))
        }
    }
}

/// 注入 Plasticine 主网页的 window.plasticineMac（mac-bridge.ts 的 PlasticineMacBridge）。
enum BridgeScript {
    static func source(version: String, chrome: WindowChromeState) -> String {
        let versionLiteral = String(data: try! JSONEncoder().encode(version), encoding: .utf8)!
        let inset = chrome.trafficLightInset.isFinite ? chrome.trafficLightInset : 0
        let chromeLiteral = "{ trafficLightInset: \(inset), fullScreen: \(chrome.fullScreen) }"
        let toolsLiteral = String(data: try! JSONEncoder().encode(WebPageTool.supported), encoding: .utf8)!
        // webTabs 不要回执的消息吞掉拒绝，免得页面报未处理的 Promise（拒绝的原因原生侧已经处理过）。
        // windowChrome.current() 要同步回值：原生把当前外观写进脚本，变了经 __plasticineNativeWindowChrome 更新，
        // 再转给网页自己的 __plasticineWindowChrome。
        return """
        (() => {
          const tabs = (message) => window.webkit.messageHandlers.plasticineTabs.postMessage(message);
          const quiet = (message) => { tabs(message).catch(() => undefined); };
          const logins = (message) => window.webkit.messageHandlers.plasticineLogins.postMessage(message);
          let chrome = \(chromeLiteral);
          Object.defineProperty(window, '__plasticineNativeWindowChrome', {
            value(next) {
              chrome = { trafficLightInset: next.trafficLightInset, fullScreen: next.fullScreen };
              if (typeof window.__plasticineWindowChrome === 'function') window.__plasticineWindowChrome({ ...chrome });
            },
          });
          window.plasticineMac = {
            version: \(versionLiteral),
            notify(title, body, hash) {
              window.webkit.messageHandlers.plasticineMac.postMessage({title, body, hash});
            },
            webTabs: {
              sync(state) { quiet({ type: 'sync', state }); },
              command(tabId, command) { quiet({ type: 'command', tabId, command }); },
              navigate(tabId, url) { quiet({ type: 'navigate', tabId, url }); },
              snapshot(tabId) { return tabs({ type: 'snapshot', tabId }); },
              tools: Object.freeze(\(toolsLiteral)),
              tool(tabId, tool) { return tabs({ type: 'tool', tabId, tool }); },
            },
            translate: {
              configure(tabId, config) {
                window.webkit.messageHandlers.plasticineTranslate.postMessage({ type: 'configure', tabId, config });
              },
              deliver(tabId, delivery) {
                window.webkit.messageHandlers.plasticineTranslate.postMessage({ type: 'deliver', tabId, delivery });
              },
            },
            logins: {
              sites() { return logins({ type: 'sites' }); },
              sources() { return logins({ type: 'sources' }); },
              import(request) { return logins({ type: 'import', from: request.from, passwords: request.passwords }); },
              forget(host) { return logins({ type: 'forget', host }); },
              openFullDiskAccess() { logins({ type: 'full_disk_access' }).catch(() => undefined); },
            },
            windowChrome: {
              current() { return { ...chrome }; },
              titlebar(layout) {
                window.webkit.messageHandlers.plasticineChrome.postMessage({ type: 'titlebar', layout });
              },
            },
          };
        })();
        """
    }
}
