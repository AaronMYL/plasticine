import AppKit
import ScreenCaptureKit
import ApplicationServices

struct ScreenShot {
    let geometry: ScreenGeometry
    let display: CGDirectDisplayID
    let image: CGImage
    let png: Data
    let bitmap: Bitmap?
    let capturedAt: Date
    var sha256: String { Digest.hex(png) }
}

@MainActor
package final class ScreenActions {
    var lastShot: ScreenShot?

    package init() {}

    package func capture() async throws -> JSONValue {
        let shot = try await grab()
        lastShot = shot
        return .object([
            "png": .string(shot.png.base64EncodedString()), "width": .number(Double(shot.image.width)),
            "height": .number(Double(shot.image.height))
        ])
    }

    package func click(x: Int, y: Int) async throws -> JSONValue {
        try requireAccessibility()
        let before = try currentShot()
        let point = try before.geometry.point(x: x, y: y)
        try postClick(point)
        return await afterShot(before: before)
    }

    package func type(_ text: String) async throws -> JSONValue {
        try requireAccessibility()
        let before = try? await grab()
        try await postType(text)
        return await afterShot(before: before)
    }

    package func key(_ chord: KeyChord) async throws -> JSONValue {
        try requireAccessibility()
        let before = try? await grab()
        try postKey(chord)
        return await afterShot(before: before)
    }

    package func scroll(dx: Int, dy: Int, x: Int?, y: Int?) async throws -> JSONValue {
        try requireAccessibility()
        var before: ScreenShot?
        if let x, let y {
            let shot = try currentShot()
            try postMove(try shot.geometry.point(x: x, y: y))
            before = shot
        } else {
            before = try? await grab()
        }
        guard let event = CGEvent(scrollWheelEvent2Source: nil, units: .line, wheelCount: 2,
                                  wheel1: Int32(-dy), wheel2: Int32(-dx), wheel3: 0) else {
            throw DeviceFailure.failed("无法建立滚动事件，请检查辅助功能权限。")
        }
        event.post(tap: .cghidEventTap)
        return await afterShot(before: before)
    }

    func currentShot() throws -> ScreenShot {
        guard let shot = lastShot, shot.display == CGMainDisplayID(),
              shot.geometry.frame == CGDisplayBounds(shot.display) else {
            throw DeviceFailure.stale
        }
        return shot
    }

    func afterShot(before: ScreenShot?) async -> JSONValue {
        guard let after = try? await grab() else { return .object([:]) }
        var shot: [String: JSONValue] = [
            "sha256": .string(after.sha256), "width": .number(Double(after.image.width)),
            "height": .number(Double(after.image.height)), "capturedAt": .string(Self.iso(after.capturedAt))
        ]
        var fields: [String: JSONValue] = [:]
        if let before {
            shot["beforeSha256"] = .string(before.sha256)
            if let bitmapBefore = before.bitmap, let bitmapAfter = after.bitmap,
               let changed = ImageDiff.changed(bitmapBefore, bitmapAfter) {
                fields["changed"] = .bool(changed)
            }
        }
        fields["afterShot"] = .object(shot)
        return .object(fields)
    }

    func grab() async throws -> ScreenShot {
        guard SystemAccess.screen else {
            SystemAccess.requestScreen()
            throw DeviceFailure.refused("需要屏幕录制权限")
        }
        let content = try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: true)
        let displayID = CGMainDisplayID()
        guard let display = content.displays.first(where: { $0.displayID == displayID }) else {
            throw DeviceFailure.failed("找不到主显示器，请唤醒屏幕后重试。")
        }
        let geometry = ScreenGeometry(
            frame: CGDisplayBounds(displayID), pixelWidth: CGDisplayPixelsWide(displayID),
            pixelHeight: CGDisplayPixelsHigh(displayID)
        )
        let filter = SCContentFilter(display: display, excludingWindows: [])
        let configuration = SCStreamConfiguration()
        configuration.width = geometry.width
        configuration.height = geometry.height
        configuration.showsCursor = false
        let image = try await SCScreenshotManager.captureImage(contentFilter: filter, configuration: configuration)
        try Task.checkCancellation()
        guard let png = NSBitmapImageRep(cgImage: image).representation(using: .png, properties: [:]) else {
            throw DeviceFailure.failed("截图编码失败，请重试。")
        }
        let shotGeometry = ScreenGeometry(frame: geometry.frame, pixelWidth: image.width, pixelHeight: image.height)
        return ScreenShot(
            geometry: shotGeometry, display: displayID, image: image, png: png,
            bitmap: Bitmap.from(image), capturedAt: Date()
        )
    }

    private func postClick(_ point: CGPoint) throws {
        guard let down = CGEvent(mouseEventSource: nil, mouseType: .leftMouseDown,
                                 mouseCursorPosition: point, mouseButton: .left),
              let up = CGEvent(mouseEventSource: nil, mouseType: .leftMouseUp,
                               mouseCursorPosition: point, mouseButton: .left) else {
            throw DeviceFailure.failed("无法建立鼠标事件，请检查辅助功能权限。")
        }
        down.post(tap: .cghidEventTap)
        up.post(tap: .cghidEventTap)
    }

    func postMove(_ point: CGPoint) throws {
        guard let move = CGEvent(mouseEventSource: nil, mouseType: .mouseMoved,
                                 mouseCursorPosition: point, mouseButton: .left) else {
            throw DeviceFailure.failed("无法移动鼠标，请检查辅助功能权限。")
        }
        move.post(tap: .cghidEventTap)
    }

    private func postKey(_ chord: KeyChord) throws {
        guard let down = CGEvent(keyboardEventSource: nil, virtualKey: CGKeyCode(chord.keyCode), keyDown: true),
              let up = CGEvent(keyboardEventSource: nil, virtualKey: CGKeyCode(chord.keyCode), keyDown: false) else {
            throw DeviceFailure.failed("无法建立键盘事件，请检查辅助功能权限。")
        }
        var flags = CGEventFlags()
        for modifier in chord.modifiers {
            switch modifier {
            case .command: flags.insert(.maskCommand)
            case .shift: flags.insert(.maskShift)
            case .option: flags.insert(.maskAlternate)
            case .control: flags.insert(.maskControl)
            case .function: flags.insert(.maskSecondaryFn)
            }
        }
        down.flags = flags
        up.flags = flags
        down.post(tap: .cghidEventTap)
        up.post(tap: .cghidEventTap)
    }

    private func postType(_ text: String) async throws {
        for (index, scalar) in text.unicodeScalars.enumerated() {
            if index.isMultiple(of: 32) { await Task.yield() }
            try Task.checkCancellation()
            let units = Array(String(scalar).utf16)
            guard let down = CGEvent(keyboardEventSource: nil, virtualKey: 0, keyDown: true),
                  let up = CGEvent(keyboardEventSource: nil, virtualKey: 0, keyDown: false) else {
                throw DeviceFailure.failed("无法建立键盘事件，请检查辅助功能权限。")
            }
            units.withUnsafeBufferPointer {
                down.keyboardSetUnicodeString(stringLength: units.count, unicodeString: $0.baseAddress!)
                up.keyboardSetUnicodeString(stringLength: units.count, unicodeString: $0.baseAddress!)
            }
            down.post(tap: .cghidEventTap)
            up.post(tap: .cghidEventTap)
        }
    }

    func requireAccessibility() throws {
        guard SystemAccess.accessibility else {
            SystemAccess.requestAccessibility()
            throw DeviceFailure.refused("需要辅助功能权限")
        }
    }

    private static func iso(_ date: Date) -> String {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter.string(from: date)
    }
}
