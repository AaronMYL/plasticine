import AppKit
import UserNotifications

@MainActor
final class NotificationManager: NSObject, UNUserNotificationCenterDelegate {
    private let center = UNUserNotificationCenter.current()
    var onOpen: ((String) -> Void)?

    override init() {
        super.init()
        center.delegate = self
    }

    func permissionName() async -> String {
        let settings = await center.notificationSettings()
        switch settings.authorizationStatus {
        case .authorized, .provisional: return "已允许"
        case .denied: return "未允许"
        case .notDetermined: return "尚未请求"
        @unknown default: return "请在系统设置中查看"
        }
    }

    func request() async -> Bool {
        do { return try await center.requestAuthorization(options: [.alert, .sound, .badge]) }
        catch {
            NativePrompts.show("通知权限请求失败，请在系统设置的「通知 → Plasticine」中检查。")
            return false
        }
    }

    func send(title: String, body: String, hash: String) async {
        let settings = await center.notificationSettings()
        if settings.authorizationStatus == .notDetermined, !(await request()) { return }
        if settings.authorizationStatus == .denied { return }
        let content = UNMutableNotificationContent()
        content.title = title
        content.body = body
        content.sound = .default
        content.userInfo = ["hash": String(hash.prefix(2048))]
        let request = UNNotificationRequest(identifier: UUID().uuidString, content: content, trigger: nil)
        do { try await center.add(request) }
        catch { NativePrompts.show("通知发送失败，请检查系统通知设置。") }
    }

    nonisolated func userNotificationCenter(
        _ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse,
        withCompletionHandler completionHandler: @escaping () -> Void
    ) {
        let hash = response.notification.request.content.userInfo["hash"] as? String ?? ""
        Task { @MainActor in
            onOpen?(hash)
            completionHandler()
        }
    }

    nonisolated func userNotificationCenter(
        _ center: UNUserNotificationCenter, willPresent notification: UNNotification,
        withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void
    ) {
        completionHandler([.banner, .sound])
    }
}
