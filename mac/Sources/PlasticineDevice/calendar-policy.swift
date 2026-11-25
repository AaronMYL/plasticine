import Foundation

package enum CalendarPolicy {
    package static let titleMaxChars = 200
    package static let notesMaxChars = 2_000
    package static let windowMaxDays = 92
    package static let itemsMax = 500

    package static func checkWindow(from: Date, to: Date) throws {
        guard from <= to else { throw HelperError(.invalidParams, "from 要早于 to") }
        guard to.timeIntervalSince(from) <= Double(windowMaxDays) * 86_400 else {
            throw HelperError(.invalidParams, "一次最多看 \(windowMaxDays) 天")
        }
    }

    package static func checkSpan(start: Date, end: Date) throws {
        guard start <= end else { throw HelperError(.invalidParams, "结束时间不能早于开始时间") }
    }

    package static func needsConfirmation(attendeeCount: Int) -> Bool {
        attendeeCount > 0
    }

    package static func hex(red: Double, green: Double, blue: Double) -> String {
        func byte(_ value: Double) -> Int { Int((min(1, max(0, value)) * 255).rounded()) }
        return String(format: "#%02X%02X%02X", byte(red), byte(green), byte(blue))
    }
}
