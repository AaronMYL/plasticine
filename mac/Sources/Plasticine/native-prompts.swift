import AppKit

@MainActor
enum NativePrompts {
    static func show(_ message: String, title: String = "Plasticine") {
        let alert = NSAlert()
        alert.messageText = title
        alert.informativeText = message
        alert.addButton(withTitle: "好")
        NSApp.activate(ignoringOtherApps: true)
        alert.runModal()
    }

    static func confirm(_ title: String, detail: String, accept: String = "允许", cancel: String = "不允许") async -> Bool {
        let alert = NSAlert()
        alert.messageText = title
        alert.informativeText = detail
        alert.addButton(withTitle: accept)
        alert.addButton(withTitle: cancel)
        alert.buttons[0].keyEquivalent = ""
        alert.buttons[1].keyEquivalent = "\r"
        let host = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 480, height: 100), styleMask: [.titled],
            backing: .buffered, defer: false
        )
        host.title = "Plasticine · 设备动作"
        host.isReleasedWhenClosed = false
        host.center()
        host.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
        return await withTaskCancellationHandler(operation: {
            await withCheckedContinuation { continuation in
                alert.beginSheetModal(for: host) { response in
                    host.orderOut(nil)
                    continuation.resume(returning: response == .alertFirstButtonReturn)
                }
            }
        }, onCancel: {
            Task { @MainActor in
                if let sheet = host.attachedSheet { host.endSheet(sheet, returnCode: .cancel) }
            }
        })
    }
}
