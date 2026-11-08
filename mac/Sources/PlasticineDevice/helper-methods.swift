import Foundation

// 助手会做的事（第 14 条）。名字、参数和 agent/shared/desktop-helper-protocol.ts 的 HELPER_METHODS 一一对应，
// 两边的单测各自核对同一份清单。窗口、浏览器、通知、登录这些搬进 Electron，不在这里。
package enum HelperMethod: String, CaseIterable {
    case info = "helper.info"
    case configure = "helper.configure"
    case cancel
    case permissionsStatus = "permissions.status"
    case permissionsRequest = "permissions.request"
    case screenshot
    case click
    case type
    case key
    case scroll
    case filesList = "files.list"
    case filesRead = "files.read"
    case filesWrite = "files.write"
    case commandRun = "command.run"
    case calendarList = "calendar.list"
    case calendarEvents = "calendar.events"
    case calendarCreate = "calendar.create"
    case calendarUpdate = "calendar.update"
    case remindersList = "reminders.list"
    case remindersCreate = "reminders.create"
    case remindersComplete = "reminders.complete"

    /// 每个方法认的参数名；多出来的一律拒。
    package var parameters: Set<String> {
        switch self {
        case .info, .permissionsStatus, .screenshot, .calendarList: return []
        case .configure: return ["roots"]
        case .cancel: return ["requestId"]
        case .permissionsRequest: return ["kind"]
        case .click: return ["x", "y"]
        case .type: return ["text"]
        case .key: return ["keys"]
        case .scroll: return ["dx", "dy", "x", "y"]
        case .filesList, .filesRead: return ["path"]
        case .filesWrite: return ["path", "content", "baseVersion"]
        case .commandRun: return ["command", "cwd", "timeoutSeconds", "maxOutputBytes"]
        case .calendarEvents: return ["from", "to", "calendarIds"]
        case .calendarCreate: return ["title", "start", "end", "allDay", "location", "notes", "calendarId"]
        case .calendarUpdate:
            return ["eventId", "occurrenceStart", "title", "start", "end", "allDay", "location", "notes", "confirmed"]
        case .remindersList: return ["includeCompleted", "listIds"]
        case .remindersCreate: return ["title", "due", "notes", "listId"]
        case .remindersComplete: return ["reminderId"]
        }
    }
}

/// 协议版本：改了已有方法的参数或回执形状才加一。
package enum HelperProtocol {
    package static let version = 1
    // 和服务端 input_type 一样：一次最多打 4 000 字。
    package static let typeMaxChars = 4_000
    // 一次最多滚 200 行：再多该分几次、中间截图看一眼。
    package static let scrollMaxLines = 200
    // 截图坐标的上限：截图长边最多 1600（ScreenGeometry），留足余量，越界由 ScreenGeometry 再拒。
    package static let pointMax = 100_000
    package static let pathMaxChars = 4_096
    package static let commandMaxChars = 20_000
}

/// 权限的名字：截屏、点按、日历、提醒事项。
package enum HelperPermission: String, CaseIterable {
    case screen
    case accessibility
    case calendar
    case reminders
}
