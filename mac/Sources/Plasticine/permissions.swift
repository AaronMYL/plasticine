import AppKit
import ApplicationServices
import UserNotifications

// 判断和请求在 PlasticineDevice 的 SystemAccess（和助手进程共用）；这里加上 App 自己的能力清单和打不开设置时的提示。
@MainActor
enum Permissions {
    static var screen: Bool { SystemAccess.screen }
    static var accessibility: Bool { SystemAccess.accessibility }

    static var capabilities: [ActionKind] {
        ActionKind.allCases.filter {
            switch $0 {
            case .screenCapture: return screen
            case .inputClick, .inputType: return accessibility
            default: return true
            }
        }
    }

    static var idleSeconds: Int { SystemAccess.idleSeconds }

    static var attended: Bool {
        // Five minutes without keyboard or pointer input is treated as unattended.
        idleSeconds < 300
    }

    static func openSettings(_ pane: String) {
        guard SystemAccess.openSettings(pane) else {
            NativePrompts.show("无法打开系统设置，请手动进入「隐私与安全性」或「通知」。")
            return
        }
    }

    static func requestScreen() {
        if !SystemAccess.requestScreen() {
            NativePrompts.show("无法打开系统设置，请手动进入「隐私与安全性 → 屏幕与系统音频录制」。")
        }
    }

    static func requestAccessibility() {
        if !SystemAccess.requestAccessibility() {
            NativePrompts.show("无法打开系统设置，请手动进入「隐私与安全性 → 辅助功能」。")
        }
    }
}
