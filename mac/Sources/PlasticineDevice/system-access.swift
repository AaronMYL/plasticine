import AppKit
import ApplicationServices

// 截屏和点按要的两项系统权限（屏幕录制、辅助功能）。App 的设置窗口和助手进程（第 14 条）都从这里问、从这里请求；
// 请求时系统弹框（第一次）并打开「系统设置」里对应的那一页，由他在那里打开。日历和提醒事项在 calendar-access.swift。
@MainActor
package enum SystemAccess {
    package static let screenPane = "com.apple.preference.security?Privacy_ScreenCapture"
    package static let accessibilityPane = "com.apple.preference.security?Privacy_Accessibility"

    package static var screen: Bool { CGPreflightScreenCaptureAccess() }
    package static var accessibility: Bool { AXIsProcessTrusted() }

    /// 打开「系统设置」的某一页；打不开回 false，由调用方告诉他手动去哪。
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

    // 用户最近一次键鼠活动距今的秒数（取键盘、移动、点击里最近的一次），封顶十天。
    package static var idleSeconds: Int {
        let keyboard = CGEventSource.secondsSinceLastEventType(.combinedSessionState, eventType: .keyDown)
        let pointer = CGEventSource.secondsSinceLastEventType(.combinedSessionState, eventType: .mouseMoved)
        let click = CGEventSource.secondsSinceLastEventType(.combinedSessionState, eventType: .leftMouseDown)
        let seconds = min(keyboard, min(pointer, click))
        guard seconds.isFinite, seconds > 0 else { return 0 }
        return min(864_000, Int(seconds.rounded()))
    }
}
