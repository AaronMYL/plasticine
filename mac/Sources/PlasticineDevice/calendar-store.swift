import AppKit
import EventKit

// Apple 日历和提醒事项（第 15 条）：他 Mac 上的 EventKit，经 iCloud 和 iPhone 是同一份数据。读要完全访问；写完按编号
// 从系统里重新读一遍放进回执（readBack，第 102 条「完成证明」），不是把参数抄回去。最低 macOS 14，授权直接用
// requestFullAccessToEvents / requestFullAccessToReminders（Package.swift 的平台下限就是 14，不需要旧接口）。

package enum CalendarAccessState: String {
    case granted
    case writeOnly = "write_only"
    case denied
    case restricted
    case notDetermined = "not_determined"
}

/// calendar.update 要改的项；外层 nil 是不改，location / notes 的内层 nil 是清空。
package struct EventChange {
    package var title: String?
    package var start: Date?
    package var end: Date?
    package var allDay: Bool?
    package var location: String??
    package var notes: String??

    package init() {}
}

package actor CalendarStore {
    private let store = EKEventStore()

    package init() {}

    package static func state(_ type: EKEntityType) -> CalendarAccessState {
        switch EKEventStore.authorizationStatus(for: type) {
        case .fullAccess: return .granted
        case .writeOnly: return .writeOnly
        case .denied: return .denied
        case .restricted: return .restricted
        case .notDetermined: return .notDetermined
        @unknown default: return .denied
        }
    }

    /// 弹系统的授权框（只在第一次弹；拒过之后只能去系统设置里改）。回现在有没有完全访问。
    package func requestAccess(_ type: EKEntityType) async throws -> Bool {
        let granted: Bool
        switch type {
        case .event: granted = try await store.requestFullAccessToEvents()
        case .reminder: granted = try await store.requestFullAccessToReminders()
        @unknown default: granted = false
        }
        // 授权前建的 store 看不到数据，授权后重置一次。
        if granted { store.reset() }
        return granted
    }

    // MARK: 日历

    package func calendars() throws -> JSONValue {
        try requireAccess(.event)
        let calendars = store.calendars(for: .event).sorted { $0.title < $1.title }
        return .object(["calendars": .array(calendars.map(describeCalendar))])
    }

    package func events(from: Date, to: Date, calendarIds: [String]?) throws -> JSONValue {
        try requireAccess(.event)
        try CalendarPolicy.checkWindow(from: from, to: to)
        let calendars = try pick(calendarIds, type: .event)
        let predicate = store.predicateForEvents(withStart: from, end: to, calendars: calendars)
        let found = store.events(matching: predicate).sorted { $0.startDate < $1.startDate }
        let shown = found.prefix(CalendarPolicy.itemsMax)
        return .object(["events": .array(shown.map(describeEvent)), "truncated": .bool(found.count > shown.count)])
    }

    package func createEvent(title: String, start: Date, end: Date, allDay: Bool, location: String?, notes: String?,
                             calendarId: String?) throws -> JSONValue {
        try requireAccess(.event)
        try CalendarPolicy.checkSpan(start: start, end: end)
        let event = EKEvent(eventStore: store)
        event.title = title
        event.startDate = start
        event.endDate = end
        event.isAllDay = allDay
        event.location = location
        event.notes = notes
        guard let calendar = try pick(calendarId.map { [$0] }, type: .event)?.first
                ?? store.defaultCalendarForNewEvents else {
            throw HelperError(.failed, "这台 Mac 上没有能写的日历：先在「日历」App 里建一个。")
        }
        guard calendar.allowsContentModifications else { throw HelperError(.refused, "这个日历是只读的") }
        event.calendar = calendar
        try store.save(event, span: .thisEvent, commit: true)
        return try eventReadBack(event.eventIdentifier, occurrenceStart: start)
    }

    package func updateEvent(id: String, occurrenceStart: Date?, change: EventChange,
                             confirmed: Bool) throws -> JSONValue {
        try requireAccess(.event)
        let event = try findEvent(id, occurrenceStart: occurrenceStart)
        if CalendarPolicy.needsConfirmation(attendeeCount: event.attendees?.count ?? 0), !confirmed {
            throw HelperError(.needsConfirmation,
                              "这个日程有别人参加：改了会通知对方或改动别人的邀请，先问他，他点了再带 confirmed 重发。")
        }
        guard event.calendar.allowsContentModifications else { throw HelperError(.refused, "这个日历是只读的") }
        if let title = change.title { event.title = title }
        if let start = change.start { event.startDate = start }
        if let end = change.end { event.endDate = end }
        if let allDay = change.allDay { event.isAllDay = allDay }
        if let location = change.location { event.location = location }
        if let notes = change.notes { event.notes = notes }
        try CalendarPolicy.checkSpan(start: event.startDate, end: event.endDate)
        try store.save(event, span: .thisEvent, commit: true)
        return try eventReadBack(event.eventIdentifier, occurrenceStart: event.startDate)
    }

    // MARK: 提醒事项

    package func reminders(includeCompleted: Bool, listIds: [String]?) async throws -> JSONValue {
        try requireAccess(.reminder)
        let lists = try pick(listIds, type: .reminder)
        let predicate = includeCompleted ? store.predicateForReminders(in: lists)
            : store.predicateForIncompleteReminders(withDueDateStarting: nil, ending: nil, calendars: lists)
        let described: [(due: Date?, title: String, value: JSONValue)] = await withCheckedContinuation { done in
            _ = store.fetchReminders(matching: predicate) { found in
                done.resume(returning: (found ?? []).map { reminder in
                    (due: reminder.dueMoment, title: reminder.title ?? "", value: Self.describeReminder(reminder))
                })
            }
        }
        let sorted = described.sorted { left, right in
            switch (left.due, right.due) {
            case let (l?, r?): return l == r ? left.title < right.title : l < r
            case (.some, .none): return true
            case (.none, .some): return false
            case (.none, .none): return left.title < right.title
            }
        }
        let shown = sorted.prefix(CalendarPolicy.itemsMax)
        let listsValue = store.calendars(for: .reminder).sorted { $0.title < $1.title }.map(describeCalendar)
        return .object([
            "reminders": .array(shown.map(\.value)), "truncated": .bool(sorted.count > shown.count),
            "lists": .array(listsValue)
        ])
    }

    package func createReminder(title: String, due: Date?, notes: String?, listId: String?) throws -> JSONValue {
        try requireAccess(.reminder)
        let reminder = EKReminder(eventStore: store)
        reminder.title = title
        reminder.notes = notes
        guard let list = try pick(listId.map { [$0] }, type: .reminder)?.first
                ?? store.defaultCalendarForNewReminders() else {
            throw HelperError(.failed, "这台 Mac 上没有提醒事项列表：先在「提醒事项」App 里建一个。")
        }
        guard list.allowsContentModifications else { throw HelperError(.refused, "这个列表是只读的") }
        reminder.calendar = list
        if let due {
            let parts: Set<Calendar.Component> = [.year, .month, .day, .hour, .minute, .second, .timeZone]
            reminder.dueDateComponents = Calendar.current.dateComponents(parts, from: due)
            // 到点 iPhone 和 Mac 会响：提醒事项只有带闹钟才通知。
            reminder.addAlarm(EKAlarm(absoluteDate: due))
        }
        try store.save(reminder, commit: true)
        let saved = try findReminder(reminder.calendarItemIdentifier)
        return .object([
            "reminderId": .string(saved.calendarItemIdentifier),
            "readBack": .object([
                "title": .string(saved.title ?? ""),
                "due": saved.dueMoment.map { .string(HelperTime.format($0)) } ?? .null,
                "completed": .bool(saved.isCompleted)
            ])
        ])
    }

    package func completeReminder(id: String) throws -> JSONValue {
        try requireAccess(.reminder)
        let reminder = try findReminder(id)
        guard reminder.calendar.allowsContentModifications else { throw HelperError(.refused, "这个列表是只读的") }
        reminder.isCompleted = true
        try store.save(reminder, commit: true)
        let saved = try findReminder(id)
        let readBack: JSONValue = .object(["title": .string(saved.title ?? ""), "completed": .bool(saved.isCompleted)])
        return .object(["readBack": readBack])
    }

    // MARK: 内部

    private func requireAccess(_ type: EKEntityType) throws {
        guard Self.state(type) == .granted else {
            let what = type == .event ? "日历" : "提醒事项"
            throw HelperError(.permissionDenied,
                              "没有\(what)的完全访问权限：在「系统设置 → 隐私与安全性 → \(what)」里允许 Plasticine。")
        }
    }

    /// 按编号挑日历；nil 是全部。编号对不上的拒，不悄悄忽略。
    private func pick(_ ids: [String]?, type: EKEntityType) throws -> [EKCalendar]? {
        guard let ids else { return nil }
        return try ids.map { id in
            guard let calendar = store.calendar(withIdentifier: id),
                  calendar.allowedEntityTypes.contains(type == .event ? .event : .reminder) else {
                throw HelperError(.notFound, "找不到这个\(type == .event ? "日历" : "提醒事项列表")：\(id)")
            }
            return calendar
        }
    }

    private func findEvent(_ id: String, occurrenceStart: Date?) throws -> EKEvent {
        // 重复日程的每一次共用一个编号：给了这一次的开始时间就在它前后一分钟里找那一次，只改这一次。
        if let occurrenceStart {
            let window = store.predicateForEvents(withStart: occurrenceStart.addingTimeInterval(-60),
                                                  end: occurrenceStart.addingTimeInterval(60), calendars: nil)
            if let match = store.events(matching: window).first(where: {
                $0.eventIdentifier == id && abs($0.startDate.timeIntervalSince(occurrenceStart)) < 1
            }) {
                return match
            }
        }
        guard let event = store.event(withIdentifier: id) else { throw HelperError(.notFound, "找不到这个日程") }
        return event
    }

    private func findReminder(_ id: String) throws -> EKReminder {
        guard let reminder = store.calendarItem(withIdentifier: id) as? EKReminder else {
            throw HelperError(.notFound, "找不到这条提醒事项")
        }
        return reminder
    }

    private func eventReadBack(_ id: String, occurrenceStart: Date) throws -> JSONValue {
        let saved = try findEvent(id, occurrenceStart: occurrenceStart)
        return .object([
            "eventId": .string(saved.eventIdentifier),
            "readBack": .object([
                "title": .string(saved.title ?? ""), "start": .string(HelperTime.format(saved.startDate)),
                "end": .string(HelperTime.format(saved.endDate)), "allDay": .bool(saved.isAllDay)
            ])
        ])
    }

    private func describeCalendar(_ calendar: EKCalendar) -> JSONValue {
        .object([
            "id": .string(calendar.calendarIdentifier), "title": .string(calendar.title),
            "color": .string(Self.hex(calendar)), "source": .string(calendar.source?.title ?? ""),
            "writable": .bool(calendar.allowsContentModifications)
        ])
    }

    private func describeEvent(_ event: EKEvent) -> JSONValue {
        .object([
            "id": .string(event.eventIdentifier ?? event.calendarItemIdentifier), "title": .string(event.title ?? ""),
            "start": .string(HelperTime.format(event.startDate)), "end": .string(HelperTime.format(event.endDate)),
            "allDay": .bool(event.isAllDay), "location": event.location.map(JSONValue.string) ?? .null,
            "notes": event.notes.map(JSONValue.string) ?? .null, "calendar": .string(event.calendar?.title ?? ""),
            "calendarId": .string(event.calendar?.calendarIdentifier ?? ""),
            "color": .string(event.calendar.map(Self.hex) ?? Self.fallbackColor),
            "withOthers": .bool(CalendarPolicy.needsConfirmation(attendeeCount: event.attendees?.count ?? 0))
        ])
    }

    private static func describeReminder(_ reminder: EKReminder) -> JSONValue {
        let components = reminder.dueDateComponents
        return .object([
            "id": .string(reminder.calendarItemIdentifier), "title": .string(reminder.title ?? ""),
            "due": reminder.dueMoment.map { .string(HelperTime.format($0)) } ?? .null,
            "dueHasTime": .bool(components?.hour != nil), "completed": .bool(reminder.isCompleted),
            "notes": reminder.notes.map(JSONValue.string) ?? .null, "list": .string(reminder.calendar?.title ?? ""),
            "listId": .string(reminder.calendar?.calendarIdentifier ?? ""),
            "color": .string(reminder.calendar.map(hex) ?? fallbackColor)
        ])
    }

    // 系统灰：日历没有颜色时（很少见）用它。
    private static let fallbackColor = "#8E8E93"

    private static func hex(_ calendar: EKCalendar) -> String {
        guard let color = calendar.color?.usingColorSpace(.sRGB) else { return fallbackColor }
        return CalendarPolicy.hex(red: Double(color.redComponent), green: Double(color.greenComponent),
                                  blue: Double(color.blueComponent))
    }
}

extension EKReminder {
    /// 到期时间：dueDateComponents 按日历换成时刻（只有日期的按当天零点）。
    var dueMoment: Date? {
        dueDateComponents.flatMap { Calendar.current.date(from: $0) }
    }
}
