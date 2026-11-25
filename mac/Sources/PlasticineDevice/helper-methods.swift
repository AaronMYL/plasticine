import Foundation

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
    case mouse
    case screenshotRegion = "screenshot.region"
    case screenshotWindow = "screenshot.window"
    case appsList = "apps.list"
    case windowsList = "windows.list"
    case windowAct = "window.act"
    case axPerceive = "ax.perceive"
    case axAct = "ax.act"
    case menuList = "menu.list"
    case menuPress = "menu.press"
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

    package var parameters: Set<String> {
        switch self {
        case .info, .permissionsStatus, .screenshot, .calendarList, .appsList, .windowsList: return []
        case .configure: return ["roots"]
        case .cancel: return ["requestId"]
        case .permissionsRequest: return ["kind"]
        case .click: return ["x", "y"]
        case .type: return ["text"]
        case .key: return ["keys"]
        case .scroll: return ["dx", "dy", "x", "y"]
        case .mouse: return ["op", "x", "y", "toX", "toY"]
        case .screenshotRegion: return ["x", "y", "width", "height"]
        case .screenshotWindow: return ["window"]
        case .windowAct: return ["window", "op", "x", "y", "width", "height"]
        case .axPerceive, .menuList: return ["app"]
        case .axAct: return ["app", "version", "n", "op", "text"]
        case .menuPress: return ["app", "path"]
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

package enum HelperProtocol {
    package static let version = 1
    package static let typeMaxChars = 4_000
    package static let scrollMaxLines = 200
    package static let pointMax = 100_000
    package static let pathMaxChars = 4_096
    package static let commandMaxChars = 20_000
}

package enum HelperPermission: String, CaseIterable {
    case screen
    case accessibility
    case calendar
    case reminders
}
