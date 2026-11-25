import AppKit
import ApplicationServices

@MainActor
package enum SystemAccess {
    package static let screenPane = "com.apple.preference.security?Privacy_ScreenCapture"
    package static let accessibilityPane = "com.apple.preference.security?Privacy_Accessibility"

    package static var screen: Bool { CGPreflightScreenCaptureAccess() }
    package static var accessibility: Bool { AXIsProcessTrusted() }

    @discardableResult
    package static func openSettings(_ pane: String) -> Bool {
        guard let url = URL(string: "x-apple.systempreferences:" + pane) else { return false }
        return NSWorkspace.shared.open(url)
    }

    @discardableResult
    package static func requestScreen() -> Bool {
        _ = CGRequestScreenCaptureAccess()
        return openSettings(screenPane)
    }

    @discardableResult
    package static func requestAccessibility() -> Bool {
        let options = [kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String: true] as CFDictionary
        _ = AXIsProcessTrustedWithOptions(options)
        return openSettings(accessibilityPane)
    }

    package static var idleSeconds: Int {
        let keyboard = CGEventSource.secondsSinceLastEventType(.combinedSessionState, eventType: .keyDown)
        let pointer = CGEventSource.secondsSinceLastEventType(.combinedSessionState, eventType: .mouseMoved)
        let click = CGEventSource.secondsSinceLastEventType(.combinedSessionState, eventType: .leftMouseDown)
        let seconds = min(keyboard, min(pointer, click))
        guard seconds.isFinite, seconds > 0 else { return 0 }
        return min(864_000, Int(seconds.rounded()))
    }
}
