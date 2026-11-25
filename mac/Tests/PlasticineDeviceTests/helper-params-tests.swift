import Foundation
import XCTest
@testable import PlasticineDevice

final class HelperParamsTests: XCTestCase {
    func test多出来的参数一律拒() {
        let extra: JSONValue = .object(["path": .string("~"), "mode": .string("x")])
        XCTAssertThrowsError(try HelperParams(extra, allowed: ["path"])) {
            XCTAssertEqual(($0 as? HelperError)?.code, .invalidParams)
        }
        XCTAssertNoThrow(try HelperParams(.null, allowed: []))
        XCTAssertThrowsError(try HelperParams(.array([]), allowed: []))
    }

    func test字符串整数布尔按范围核对() throws {
        let params = try HelperParams(.object([
            "text": .string("你好"), "empty": .string(""), "x": .number(12), "half": .number(1.5),
            "big": .number(1e300), "flag": .bool(true), "nothing": .null
        ]), allowed: ["text", "empty", "x", "half", "big", "flag", "nothing"])
        XCTAssertEqual(try params.string("text", maxChars: 2), "你好")
        XCTAssertThrowsError(try params.string("text", maxChars: 1))
        XCTAssertThrowsError(try params.string("empty"))
        XCTAssertEqual(try params.optionalString("empty", allowEmpty: true), "")
        XCTAssertNil(try params.optionalString("nothing"))
        XCTAssertEqual(try params.int("x", in: 0...100), 12)
        XCTAssertThrowsError(try params.int("x", in: 0...10))
        XCTAssertThrowsError(try params.int("half", in: 0...10))
        XCTAssertThrowsError(try params.int("big", in: 0...10))
        XCTAssertTrue(try params.bool("flag", default: false))
        XCTAssertFalse(try params.bool("nothing", default: false))
        XCTAssertThrowsError(try params.bool("text", default: false))
        XCTAssertTrue(params.has("nothing"))
        XCTAssertFalse(params.has("missing"))
    }

    func test时间认带不带小数秒和时区偏移() throws {
        let params = try HelperParams(.object([
            "a": .string("2026-11-08T14:00:00+08:00"), "b": .string("2026-11-08T06:00:00.250Z"),
            "bad": .string("明天下午")
        ]), allowed: ["a", "b", "bad"])
        XCTAssertEqual(HelperTime.format(try params.date("a")), "2026-11-08T06:00:00.000Z")
        XCTAssertEqual(HelperTime.format(try params.date("b")), "2026-11-08T06:00:00.250Z")
        XCTAssertThrowsError(try params.date("bad"))
        XCTAssertNil(try params.optionalDate("missing"))
    }

    func test字符串数组() throws {
        let params = try HelperParams(.object([
            "ids": .array([.string("a"), .string("b")]), "mixed": .array([.string("a"), .number(1)])
        ]), allowed: ["ids", "mixed"])
        XCTAssertEqual(try params.strings("ids"), ["a", "b"])
        XCTAssertThrowsError(try params.strings("mixed"))
        XCTAssertThrowsError(try params.strings("ids", maxItems: 1))
        XCTAssertNil(try params.strings("missing"))
    }

    func test每个方法的参数表不含重复也覆盖取消() {
        XCTAssertEqual(HelperMethod.cancel.parameters, ["requestId"])
        XCTAssertEqual(HelperMethod(rawValue: "calendar.events"), .calendarEvents)
        XCTAssertNil(HelperMethod(rawValue: "browser.open"))
        XCTAssertTrue(HelperMethod.calendarUpdate.parameters.contains("confirmed"))
    }
}
