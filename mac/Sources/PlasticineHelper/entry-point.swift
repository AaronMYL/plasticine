import AppKit
import PlasticineDevice

// 设备助手（第 14 条，用户 11-06 定）：由 Electron 壳拉起，stdin / stdout 上收发 JSON 行，负责截屏、点按、
// 辅助功能、文件、命令、Apple 日历和提醒事项。没有窗口，也不出现在 Dock（.prohibited）；仍起 NSApplication，
// 让截屏和事件投递连着窗口服务器。系统权限（屏幕录制、辅助功能、日历、提醒事项）记在拉起它的 App 名下，
// 所以壳的 Info.plist 要带日历和提醒事项的用途说明（见 docs/specs/desktop-helper-mac.md）。
@main
enum PlasticineHelperMain {
    @MainActor
    static func main() {
        // command.run 用自己当子进程起 zsh（和 App 一样，见 CommandChild）：这一步必须在最前面。
        CommandChild.runIfRequested()
        let application = NSApplication.shared
        application.setActivationPolicy(.prohibited)
        let server = HelperServer(handler: HelperDispatcher())
        server.start()
        withExtendedLifetime(server) { application.run() }
    }
}
