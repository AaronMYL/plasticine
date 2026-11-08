import AppKit

@MainActor
final class PairingWindow: NSObject {
    private let service: NodeService
    private let window: NSWindow
    private let code = NSSecureTextField()
    private let message = NativeLayout.label("")
    private var button: NSButton!
    private var lastCode = ""
    private var requestID = UUID().uuidString

    init(service: NodeService) {
        self.service = service
        window = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 500, height: 260),
            styleMask: [.titled, .closable], backing: .buffered, defer: false
        )
        super.init()
        window.title = "配对这台 Mac"
        window.isReleasedWhenClosed = false
        window.center()
        let column = NativeLayout.column(in: window)
        column.addArrangedSubview(NativeLayout.label("在网页「设备与度量 → 设备」生成配对码，再填到这里。"))
        code.placeholderString = "配对码"
        column.addArrangedSubview(code)
        code.widthAnchor.constraint(equalTo: column.widthAnchor).isActive = true
        button = NativeLayout.button("配对", target: self, action: #selector(submit))
        button.keyEquivalent = "\r"
        column.addArrangedSubview(button)
        column.addArrangedSubview(message)
    }

    func show() {
        window.makeKeyAndOrderFront(nil)
        window.makeFirstResponder(code)
        NSApp.activate(ignoringOtherApps: true)
    }

    @objc private func submit() {
        let value = code.stringValue.trimmingCharacters(in: .whitespacesAndNewlines)
        guard (4...20).contains(value.count) else {
            message.stringValue = "请输入 4 至 20 位配对码。"
            return
        }
        if value != lastCode {
            lastCode = value
            requestID = UUID().uuidString
        }
        button.isEnabled = false
        code.isEnabled = false
        message.stringValue = "正在配对…"
        Task {
            defer {
                button.isEnabled = true
                code.isEnabled = true
            }
            do {
                try await service.pair(code: value, requestID: requestID)
                code.stringValue = ""
                lastCode = ""
                message.stringValue = "配对完成，设备服务已启动。"
            } catch NodeHTTPError.unauthorized {
                message.stringValue = "配对码无效或过期，请在网页重新生成。"
            } catch {
                message.stringValue = "配对未完成：\(error.localizedDescription) 重试会沿用这次请求。"
            }
        }
    }
}
