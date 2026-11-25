import AppKit
import ScreenCaptureKit
import ApplicationServices

extension ScreenActions {
    package func mouse(op: String, x: Int, y: Int, toX: Int?, toY: Int?) async throws -> JSONValue {
        try requireAccessibility()
        let before = try currentShot()
        let point = try before.geometry.point(x: x, y: y)
        switch op {
        case "double": try postButton(point, button: .left, clicks: 2)
        case "right": try postButton(point, button: .right, clicks: 1)
        case "middle": try postButton(point, button: .center, clicks: 1)
        case "move": try postMove(point)
        case "drag":
            guard let toX, let toY else { throw HelperError(.invalidParams, "拖动要给 toX 和 toY") }
            try await postDrag(from: point, to: try before.geometry.point(x: toX, y: toY))
        default: throw HelperError(.invalidParams, "op 只能是 double、right、middle、move、drag")
        }
        return await afterShot(before: before)
    }

    package func region(x: Int, y: Int, width: Int, height: Int) async throws -> JSONValue {
        let shot = try currentShot()
        let topLeft = try shot.geometry.point(x: x, y: y)
        let right = min(shot.geometry.width - 1, x + width)
        let bottom = min(shot.geometry.height - 1, y + height)
        let bottomRight = try shot.geometry.point(x: right, y: bottom)
        let rect = CGRect(x: topLeft.x - shot.geometry.frame.minX, y: topLeft.y - shot.geometry.frame.minY,
                          width: max(1, bottomRight.x - topLeft.x), height: max(1, bottomRight.y - topLeft.y))
        let content = try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: true)
        guard let display = content.displays.first(where: { $0.displayID == shot.display }) else {
            throw DeviceFailure.failed("找不到主显示器，请唤醒屏幕后重试。")
        }
        let scale = Double(CGDisplayPixelsWide(shot.display)) / max(1, shot.geometry.frame.width)
        let configuration = SCStreamConfiguration()
        configuration.sourceRect = rect
        configuration.width = max(1, Int(rect.width * scale))
        configuration.height = max(1, Int(rect.height * scale))
        configuration.showsCursor = false
        let image = try await SCScreenshotManager.captureImage(
            contentFilter: SCContentFilter(display: display, excludingWindows: []), configuration: configuration)
        return try Self.png(image)
    }

    package func window(_ id: String) async throws -> JSONValue {
        guard SystemAccess.screen else {
            SystemAccess.requestScreen()
            throw DeviceFailure.refused("需要屏幕录制权限")
        }
        let target = try AXActions.windowInfo(id)
        let content = try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: false)
        let candidates = content.windows.filter { $0.owningApplication?.processID == target.pid }
        guard let window = candidates.first(where: { ($0.title ?? "") == target.title && target.title != "" })
                ?? candidates.first(where: { abs($0.frame.minX - target.frame.minX) < 2
                    && abs($0.frame.minY - target.frame.minY) < 2 }) else {
            throw DeviceFailure.failed("找不到这个窗口（可能关了）：重新 window_list。")
        }
        let configuration = SCStreamConfiguration()
        let scale = NSScreen.main?.backingScaleFactor ?? 2
        configuration.width = max(1, Int(window.frame.width * scale))
        configuration.height = max(1, Int(window.frame.height * scale))
        configuration.showsCursor = false
        let image = try await SCScreenshotManager.captureImage(
            contentFilter: SCContentFilter(desktopIndependentWindow: window), configuration: configuration)
        return try Self.png(image)
    }

    private static func png(_ image: CGImage) throws -> JSONValue {
        guard let png = NSBitmapImageRep(cgImage: image).representation(using: .png, properties: [:]) else {
            throw DeviceFailure.failed("截图编码失败，请重试。")
        }
        return .object(["png": .string(png.base64EncodedString()), "width": .number(Double(image.width)),
                        "height": .number(Double(image.height))])
    }

    private func postButton(_ point: CGPoint, button: CGMouseButton, clicks: Int) throws {
        let (downType, upType): (CGEventType, CGEventType) = switch button {
        case .right: (.rightMouseDown, .rightMouseUp)
        case .left: (.leftMouseDown, .leftMouseUp)
        default: (.otherMouseDown, .otherMouseUp)
        }
        for click in 1...clicks {
            guard let down = CGEvent(mouseEventSource: nil, mouseType: downType, mouseCursorPosition: point,
                                     mouseButton: button),
                  let up = CGEvent(mouseEventSource: nil, mouseType: upType, mouseCursorPosition: point,
                                   mouseButton: button) else {
                throw DeviceFailure.failed("无法建立鼠标事件，请检查辅助功能权限。")
            }
            down.setIntegerValueField(.mouseEventClickState, value: Int64(click))
            up.setIntegerValueField(.mouseEventClickState, value: Int64(click))
            down.post(tap: .cghidEventTap)
            up.post(tap: .cghidEventTap)
        }
    }

    private func postDrag(from start: CGPoint, to end: CGPoint) async throws {
        guard let down = CGEvent(mouseEventSource: nil, mouseType: .leftMouseDown, mouseCursorPosition: start,
                                 mouseButton: .left) else {
            throw DeviceFailure.failed("无法建立鼠标事件，请检查辅助功能权限。")
        }
        down.post(tap: .cghidEventTap)
        for step in 1...10 {
            let point = CGPoint(x: start.x + (end.x - start.x) * Double(step) / 10,
                                y: start.y + (end.y - start.y) * Double(step) / 10)
            CGEvent(mouseEventSource: nil, mouseType: .leftMouseDragged, mouseCursorPosition: point,
                    mouseButton: .left)?.post(tap: .cghidEventTap)
            try await Task.sleep(nanoseconds: 15_000_000)
        }
        CGEvent(mouseEventSource: nil, mouseType: .leftMouseUp, mouseCursorPosition: end,
                mouseButton: .left)?.post(tap: .cghidEventTap)
    }
}
