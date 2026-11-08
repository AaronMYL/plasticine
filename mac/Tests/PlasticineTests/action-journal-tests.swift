import Foundation
import XCTest
@testable import Plasticine

final class ActionJournalTests: XCTestCase {
    func test重启重传同一结果并保留已确认动作的去重记录() throws {
        let base = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try! FileManager.default.removeItem(at: base) }
        let server = URL(string: "https://example.com/")!
        let action = RemoteAction(id: "one", kind: "file_write", params: .object([:]), deadline: "invalid")
        let report = ActionReport.executed(.object(["version": .string("file-version")]))
        let first = try ActionJournal(server: server, nodeID: "mac", base: base)
        try first.begin(action, actionClass: "write")
        try first.finish(action.id, report: report)
        let resumed = try ActionJournal(server: server, nodeID: "mac", base: base)
        XCTAssertEqual(resumed.pending.first?.report, report)
        try resumed.markUploaded(action.id)
        XCTAssertTrue(resumed.pending.isEmpty)
        XCTAssertEqual(resumed.lookup(action.id), report)
        try resumed.finish(action.id, report: report)
        XCTAssertEqual(resumed.pending.first?.report, report)
        XCTAssertEqual(resumed.usedThisHour("write"), 1)
    }

    func test执行中断留下待核实结果且不同节点不共用记录() throws {
        let base = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try! FileManager.default.removeItem(at: base) }
        let server = URL(string: "https://example.com/")!
        let first = try ActionJournal(server: server, nodeID: "mac", base: base)
        let action = RemoteAction(id: "one", kind: "run_command", params: .null, deadline: "")
        try first.begin(action, actionClass: "command")
        let resumed = try ActionJournal(server: server, nodeID: "mac", base: base)
        XCTAssertEqual(resumed.lookup("one")?.status, "failed")
        XCTAssertTrue(resumed.lookup("one")?.error?.contains("结果待核实") == true)
        let other = try ActionJournal(server: server, nodeID: "other", base: base)
        XCTAssertNil(other.lookup("one"))
    }
}
