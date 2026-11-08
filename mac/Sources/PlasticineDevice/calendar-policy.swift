import Foundation

// Apple 日历和提醒事项（第 15 条，用户 11-06 定）的纯规则，单测在 PlasticineDeviceTests。
// 硬线：替他建日程、建提醒、标完成是「替他动手」，直接做；改有别人参加的日程（别人发来的邀请，或他发给别人的、
// 改了系统会通知对方）算撤不回或对外，没有带 confirmed（服务端出卡、他点了）就不做，回 needs_confirmation。
package enum CalendarPolicy {
    // 和服务端 shared/api/device-ios.ts 的上限一样：标题一行、备注一段话。
    package static let titleMaxChars = 200
    package static let notesMaxChars = 2_000
    // 一次最多看 92 天（一个季度）：首页和心跳只看今天和接下来 7 天，再长是写错了。
    package static let windowMaxDays = 92
    // 一次最多回这么多条：再多的截断并说 truncated，工具结果放不下更多。
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

    /// 改这个日程要不要先问他：有别人参加就要。
    package static func needsConfirmation(attendeeCount: Int) -> Bool {
        attendeeCount > 0
    }

    /// 日历颜色写成 #RRGGBB（分量 0–1，超出按边界算）。
    package static func hex(red: Double, green: Double, blue: Double) -> String {
        func byte(_ value: Double) -> Int { Int((min(1, max(0, value)) * 255).rounded()) }
        return String(format: "#%02X%02X%02X", byte(red), byte(green), byte(blue))
    }
}
