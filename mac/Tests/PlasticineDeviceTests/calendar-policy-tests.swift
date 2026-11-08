import Foundation
import XCTest
@testable import PlasticineDevice

final class CalendarPolicyTests: XCTestCase {
    func test一次最多看92天且起点不晚于终点() {
        let start = Date(timeIntervalSince1970: 1_800_000_000)
        XCTAssertNoThrow(try CalendarPolicy.checkWindow(from: start, to: start.addingTimeInterval(92 * 86_400)))
        XCTAssertThrowsError(try CalendarPolicy.checkWindow(from: start, to: start.addingTimeInterval(93 * 86_400)))
        XCTAssertThrowsError(try CalendarPolicy.checkWindow(from: start, to: start.addingTimeInterval(-1)))
        XCTAssertThrowsError(try CalendarPolicy.checkSpan(start: start, end: start.addingTimeInterval(-60)))
    }

    func test有别人参加的日程改之前要他点() {
        XCTAssertTrue(CalendarPolicy.needsConfirmation(attendeeCount: 1))
        XCTAssertFalse(CalendarPolicy.needsConfirmation(attendeeCount: 0))
    }

    func test日历颜色写成十六进制() {
        XCTAssertEqual(CalendarPolicy.hex(red: 0, green: 0.478, blue: 1), "#007AFF")
        XCTAssertEqual(CalendarPolicy.hex(red: 1.2, green: -1, blue: 0.5), "#FF0080")
    }
}
