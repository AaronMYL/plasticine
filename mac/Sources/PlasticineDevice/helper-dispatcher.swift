import EventKit
import Foundation

@MainActor
package protocol HelperHandling: AnyObject {
    func handle(_ request: HelperRequest) async throws -> JSONValue
}

@MainActor
package final class HelperDispatcher: HelperHandling {
    private let screen = ScreenActions()
    private let files = FileActions()
    private let calendar = CalendarStore()
    private let ax = AXActions()
    private var roots: [String]

    package init(roots: [String] = [FileManager.default.homeDirectoryForCurrentUser.path]) {
        self.roots = roots
    }

    package func handle(_ request: HelperRequest) async throws -> JSONValue {
        guard let method = HelperMethod(rawValue: request.method) else {
            throw HelperError(.unknownMethod, "助手不会「\(request.method)」")
        }
        let params = try HelperParams(request.params, allowed: method.parameters)
        try Task.checkCancellation()
        switch method {
        case .info: return info()
        case .configure:
            roots = try params.strings("roots", maxChars: HelperProtocol.pathMaxChars) ?? []
            return .object(["roots": .array(roots.map(JSONValue.string))])
        case .cancel:
            throw HelperError(.invalidRequest, "cancel 只能经助手的服务端循环发")
        case .permissionsStatus: return permissionsStatus()
        case .permissionsRequest: return try await requestPermission(params)
        case .screenshot: return try await screen.capture()
        case .click:
            let x = try params.int("x", in: 0...HelperProtocol.pointMax)
            return try await screen.click(x: x, y: try params.int("y", in: 0...HelperProtocol.pointMax))
        case .type: return try await screen.type(try params.string("text", maxChars: HelperProtocol.typeMaxChars))
        case .key: return try await screen.key(try KeyChord.parse(try params.string("keys", maxChars: 60)))
        case .scroll: return try await scroll(params)
        case .mouse:
            let point = 0...HelperProtocol.pointMax
            return try await screen.mouse(op: try params.string("op", maxChars: 10),
                                          x: try params.int("x", in: point), y: try params.int("y", in: point),
                                          toX: try params.optionalInt("toX", in: point),
                                          toY: try params.optionalInt("toY", in: point))
        case .screenshotRegion:
            let point = 0...HelperProtocol.pointMax
            return try await screen.region(x: try params.int("x", in: point), y: try params.int("y", in: point),
                                           width: try params.int("width", in: 1...HelperProtocol.pointMax),
                                           height: try params.int("height", in: 1...HelperProtocol.pointMax))
        case .screenshotWindow: return try await screen.window(try params.string("window", maxChars: 40))
        case .appsList: return try ax.apps()
        case .windowsList: return try ax.windows()
        case .windowAct:
            return try ax.windowAct(try params.string("window", maxChars: 40),
                                    op: try params.string("op", maxChars: 20),
                                    x: try params.optionalInt("x", in: -100_000...100_000),
                                    y: try params.optionalInt("y", in: -100_000...100_000),
                                    width: try params.optionalInt("width", in: 1...HelperProtocol.pointMax),
                                    height: try params.optionalInt("height", in: 1...HelperProtocol.pointMax))
        case .axPerceive: return try ax.perceive(try params.string("app", maxChars: 200))
        case .axAct:
            return try ax.act(try params.string("app", maxChars: 200),
                              version: try params.string("version", maxChars: 40),
                              n: try params.int("n", in: 1...100_000), op: try params.string("op", maxChars: 20),
                              text: try params.optionalString("text", maxChars: 4_000, allowEmpty: true))
        case .menuList: return try ax.menu(try params.string("app", maxChars: 200), press: nil)
        case .menuPress:
            return try ax.menu(try params.string("app", maxChars: 200), press: try params.string("path", maxChars: 300))
        case .filesList, .filesRead, .filesWrite: return try await file(method, params)
        case .commandRun: return try await command(params)
        case .calendarList: return try await calendar.calendars()
        case .calendarEvents:
            return try await calendar.events(from: try params.date("from"), to: try params.date("to"),
                                             calendarIds: try params.strings("calendarIds"))
        case .calendarCreate: return try await createEvent(params)
        case .calendarUpdate: return try await updateEvent(params)
        case .remindersList:
            return try await calendar.reminders(includeCompleted: try params.bool("includeCompleted", default: false),
                                                listIds: try params.strings("listIds"))
        case .remindersCreate:
            return try await calendar.createReminder(
                title: try params.string("title", maxChars: CalendarPolicy.titleMaxChars),
                due: try params.optionalDate("due"),
                notes: try params.optionalString("notes", maxChars: CalendarPolicy.notesMaxChars, allowEmpty: true),
                listId: try params.optionalString("listId", maxChars: 200)
            )
        case .remindersComplete:
            return try await calendar.completeReminder(id: try params.string("reminderId", maxChars: 200))
        }
    }

    private func info() -> JSONValue {
        .object([
            "name": .string("plasticine-helper"), "version": .string(AppConstants.version),
            "protocol": .number(Double(HelperProtocol.version)),
            "methods": .array(HelperMethod.allCases.map { .string($0.rawValue) })
        ])
    }

    private func permissionsStatus() -> JSONValue {
        .object([
            "screen": .bool(SystemAccess.screen), "accessibility": .bool(SystemAccess.accessibility),
            "calendar": .string(CalendarStore.state(.event).rawValue),
            "reminders": .string(CalendarStore.state(.reminder).rawValue)
        ])
    }

    private func requestPermission(_ params: HelperParams) async throws -> JSONValue {
        let name = try params.string("kind", maxChars: 40)
        guard let kind = HelperPermission(rawValue: name) else {
            throw HelperError(.invalidParams, "kind 只能是 screen、accessibility、calendar、reminders")
        }
        let granted: Bool
        var settingsOpened = false
        switch kind {
        case .screen:
            settingsOpened = SystemAccess.screen ? false : SystemAccess.requestScreen()
            granted = SystemAccess.screen
        case .accessibility:
            settingsOpened = SystemAccess.accessibility ? false : SystemAccess.requestAccessibility()
            granted = SystemAccess.accessibility
        case .calendar, .reminders:
            let type: EKEntityType = kind == .calendar ? .event : .reminder
            granted = try await requestCalendar(type)
            if !granted {
                let pane = kind == .calendar ? "Privacy_Calendars" : "Privacy_Reminders"
                settingsOpened = SystemAccess.openSettings("com.apple.preference.security?" + pane)
            }
        }
        return .object(["kind": .string(kind.rawValue), "granted": .bool(granted),
                        "settingsOpened": .bool(settingsOpened)])
    }

    private func requestCalendar(_ type: EKEntityType) async throws -> Bool {
        switch CalendarStore.state(type) {
        case .granted: return true
        case .notDetermined, .writeOnly: return try await calendar.requestAccess(type)
        case .denied, .restricted: return false
        }
    }

    private func scroll(_ params: HelperParams) async throws -> JSONValue {
        let lines = -HelperProtocol.scrollMaxLines...HelperProtocol.scrollMaxLines
        let dx = try params.optionalInt("dx", in: lines) ?? 0
        let dy = try params.optionalInt("dy", in: lines) ?? 0
        let x = try params.optionalInt("x", in: 0...HelperProtocol.pointMax)
        let y = try params.optionalInt("y", in: 0...HelperProtocol.pointMax)
        guard (x == nil) == (y == nil) else { throw HelperError(.invalidParams, "x 和 y 要一起给") }
        guard dx != 0 || dy != 0 else { throw HelperError(.invalidParams, "dx、dy 至少一个不为 0") }
        return try await screen.scroll(dx: dx, dy: dy, x: x, y: y)
    }

    private func file(_ method: HelperMethod, _ params: HelperParams) async throws -> JSONValue {
        let raw = try params.string("path", maxChars: HelperProtocol.pathMaxChars)
        let path = try PathPolicy(roots: roots).authorize(raw)
        switch method {
        case .filesList: return try await files.list(path)
        case .filesRead: return try await files.read(path)
        default:
            let content = try params.optionalString("content", maxChars: AppConstants.fileBytes, allowEmpty: true)
            guard let content else { throw HelperError(.invalidParams, "参数 content 要是字符串") }
            let baseVersion = try params.optionalString("baseVersion", maxChars: 64)
            return try await files.write(path, content: content, baseVersion: baseVersion)
        }
    }

    private func command(_ params: HelperParams) async throws -> JSONValue {
        let text = try params.string("command", maxChars: HelperProtocol.commandMaxChars)
        let cwd = try params.string("cwd", maxChars: HelperProtocol.pathMaxChars)
        let directory = try PathPolicy(roots: roots).normalize(cwd)
        let seconds = try params.optionalInt("timeoutSeconds", in: 1...Int(AppConstants.commandSecondsMax))
        let bytes = try params.optionalInt("maxOutputBytes", in: 1...AppConstants.commandBytes)
        let runner = CommandRunner(timeout: seconds.map { TimeInterval($0) } ?? AppConstants.commandSeconds,
                                   outputBytes: bytes ?? AppConstants.commandBytes)
        return try JSONValue.from(try await runner.run(command: text, directory: directory))
    }

    private func createEvent(_ params: HelperParams) async throws -> JSONValue {
        try await calendar.createEvent(
            title: try params.string("title", maxChars: CalendarPolicy.titleMaxChars),
            start: try params.date("start"), end: try params.date("end"),
            allDay: try params.bool("allDay", default: false),
            location: try params.optionalString("location", maxChars: CalendarPolicy.titleMaxChars, allowEmpty: true),
            notes: try params.optionalString("notes", maxChars: CalendarPolicy.notesMaxChars, allowEmpty: true),
            calendarId: try params.optionalString("calendarId", maxChars: 200)
        )
    }

    private func updateEvent(_ params: HelperParams) async throws -> JSONValue {
        var change = EventChange()
        change.title = try params.optionalString("title", maxChars: CalendarPolicy.titleMaxChars)
        change.start = try params.optionalDate("start")
        change.end = try params.optionalDate("end")
        if params.has("allDay") {
            change.allDay = try params.bool("allDay", default: false)
        }
        if params.has("location") {
            change.location = .some(try params.optionalString("location", maxChars: CalendarPolicy.titleMaxChars,
                                                              allowEmpty: true))
        }
        if params.has("notes") {
            change.notes = .some(try params.optionalString("notes", maxChars: CalendarPolicy.notesMaxChars,
                                                           allowEmpty: true))
        }
        return try await calendar.updateEvent(
            id: try params.string("eventId", maxChars: 200),
            occurrenceStart: try params.optionalDate("occurrenceStart"),
            change: change, confirmed: try params.bool("confirmed", default: false)
        )
    }
}
